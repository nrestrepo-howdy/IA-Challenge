import { describe, it, expect } from 'vitest';
import type { Candidate, Intent, Layer, Oracle, Verdict } from '../../src/contracts.js';
import { World } from '../../src/core/world.js';
import {
  MAX_ATTEMPTS,
  runCycle,
  type CandidateGenerator,
  type RepairAgent,
  type RepairGuidance,
  type RepairRequest,
} from '../../src/runtime/index.js';
import { CANDIDATES_PER_ATTEMPT, rulesRepairAgent } from '../../src/runtime/agents.js';
import { HotInjector } from '../../src/runtime/injector.js';
import type { LoadedModule } from '../../src/runtime/loader.js';
import { makeIntent } from '../fixtures.js';
import { fakeClock, stubModule, StubModuleLoader } from './support.js';

const intent: Intent = makeIntent({ id: 'i-rain', utterance: 'make it rain' });

const noMetrics = {
  compileMs: null,
  medianFrameMs: null,
  drawCalls: null,
  pixelDelta: null,
  assertionsPassed: 0,
  assertionsTotal: 0,
} as const;

/** An oracle that rejects everything, naming the candidate so diagnoses stay distinct. */
function rejectingOracle(layer: Layer): Oracle {
  return {
    layer,
    budgetMs: 10,
    async evaluate(c: Candidate): Promise<Omit<Verdict, 'candidateId'>> {
      return {
        passed: false,
        failedAt: layer,
        diagnosis: `${layer} rejected ${c.id}: ${c.strategy} never updates the state slice`,
        metrics: noMetrics,
        frame: null,
      };
    },
  };
}

function passingOracle(layer: Layer): Oracle {
  return {
    layer,
    budgetMs: 10,
    async evaluate(): Promise<Omit<Verdict, 'candidateId'>> {
      return { passed: true, failedAt: null, diagnosis: null, metrics: noMetrics, frame: null };
    },
  };
}

interface CountingGenerator extends CandidateGenerator {
  readonly calls: { attempt: number; guidance: RepairGuidance | null }[];
}

/** Three candidates per attempt, differing by strategy — not three samples of one (D-5). */
function countingGenerator(count = CANDIDATES_PER_ATTEMPT): CountingGenerator {
  const calls: { attempt: number; guidance: RepairGuidance | null }[] = [];
  return {
    calls,
    async generate(request) {
      calls.push({ attempt: request.attempt, guidance: request.guidance });
      return Array.from({ length: count }, (_, n) => ({
        id: `a${request.attempt}-c${n}`,
        intentId: intent.id,
        strategy: ['direct', 'defensive', 'minimal'][n] ?? `s${n}`,
        source: `// attempt ${request.attempt} candidate ${n}`,
      }));
    },
  };
}

function recordingRepair(): RepairAgent & { requests: RepairRequest[] } {
  const requests: RepairRequest[] = [];
  return {
    requests,
    async repair(request) {
      requests.push(request);
      return rulesRepairAgent.repair(request);
    },
  };
}

function liveInjector() {
  const world = new World();
  const loader = new StubModuleLoader(new Map<string, LoadedModule>());
  const clock = fakeClock(1_000);
  const injector = new HotInjector({ world, loader, now: clock.now });
  return { world, loader, clock, injector };
}

describe('AC-19 · every candidate failing bounds the retries and then reports', () => {
  it('retries at most three times, proven by a counter, and never hangs', async () => {
    const generator = countingGenerator();
    const repair = recordingRepair();
    const { injector } = liveInjector();

    const result = await runCycle(intent, {
      generator,
      oracles: [passingOracle('L0'), passingOracle('L1'), rejectingOracle('L2')],
      injector,
      repair,
    });

    expect(generator.calls).toHaveLength(MAX_ATTEMPTS);
    expect(MAX_ATTEMPTS).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    // Nothing was injected, so nothing was made permanently resident (R-4).
    expect(injector.remainingBudget).toBe(32);
  });

  it('carries the diagnosis of every candidate, not one arbitrary failure, into repair', async () => {
    const generator = countingGenerator();
    const repair = recordingRepair();
    const { injector } = liveInjector();

    const result = await runCycle(intent, {
      generator,
      oracles: [rejectingOracle('L0')],
      injector,
      repair,
    });

    expect(repair.requests).toHaveLength(MAX_ATTEMPTS);
    for (const request of repair.requests) {
      expect(request.failures).toHaveLength(CANDIDATES_PER_ATTEMPT);
      expect(request.failures.map((f) => f.strategy).sort()).toEqual(['defensive', 'direct', 'minimal']);
      // Actionable text, not a score: the repair agent has to be able to act on it.
      for (const failure of request.failures) {
        expect(failure.diagnosis).toContain('never updates the state slice');
      }
    }

    if (result.ok) throw new Error('expected the cycle to fail');
    expect(result.failures).toHaveLength(MAX_ATTEMPTS * CANDIDATES_PER_ATTEMPT);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      for (let n = 0; n < CANDIDATES_PER_ATTEMPT; n += 1) {
        expect(result.report).toContain(`a${attempt}-c${n}`);
      }
    }
    expect(result.report).toContain('make it rain');
    expect(result.guidance?.instructions.join(' ')).toContain('L0');
  });

  it('feeds each attempt the previous attempt of guidance', async () => {
    const generator = countingGenerator();
    const { injector } = liveInjector();

    await runCycle(intent, { generator, oracles: [rejectingOracle('L2')], injector });

    expect(generator.calls[0]?.guidance).toBeNull();
    expect(generator.calls[1]?.guidance?.summary).toContain('attempt 1');
    expect(generator.calls[1]?.guidance?.avoidStrategies).toEqual(['direct', 'defensive', 'minimal']);
    expect(generator.calls[2]?.guidance?.summary).toContain('attempt 2');
  });

  it('reports rather than hanging when the generator produces nothing at all', async () => {
    const generator = countingGenerator(0);
    const { injector } = liveInjector();

    const result = await runCycle(intent, { generator, oracles: [passingOracle('L0')], injector });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(MAX_ATTEMPTS);
    if (result.ok) throw new Error('expected the cycle to fail');
    expect(result.report).toContain('no candidates');
  });

  it('stops at the first injectable candidate and injects it', async () => {
    const generator = countingGenerator();
    const { world, loader, injector } = liveInjector();
    for (let n = 0; n < CANDIDATES_PER_ATTEMPT; n += 1) {
      loader.set(`a1-c${n}`, stubModule(world, { id: `rain-${n}`, statePath: 'weather.rain' }).module);
    }

    const result = await runCycle(intent, {
      generator,
      // L3 rejects, and it is advisory only: taste never blocks injection (AC-11).
      oracles: [passingOracle('L0'), passingOracle('L1'), passingOracle('L2'), rejectingOracle('L3')],
      injector,
    });

    expect(result.ok).toBe(true);
    expect(generator.calls).toHaveLength(1);
    if (!result.ok) throw new Error('expected the cycle to succeed');
    expect(result.candidate.id).toBe('a1-c0');
    // The verb carries the utterance, which `inject(c, v)` alone could not know.
    expect(world.snapshot().verbs).toEqual([
      { intentId: 'i-rain', utterance: 'make it rain', source: '// attempt 1 candidate 0' },
    ]);
  });

  it('treats a refused injection as an attempt failure and keeps going', async () => {
    const generator = countingGenerator();
    const { world, loader, injector } = liveInjector();
    // No module registered for the first attempt's winner, so loading fails: a verdict
    // can clear every oracle and still not survive contact with the live world.
    for (let n = 0; n < CANDIDATES_PER_ATTEMPT; n += 1) {
      loader.set(`a2-c${n}`, stubModule(world, { id: `rain-${n}`, statePath: 'weather.rain' }).module);
    }

    const result = await runCycle(intent, {
      generator,
      oracles: [passingOracle('L0'), passingOracle('L1'), passingOracle('L2')],
      injector,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.history[0]?.failures[0]?.diagnosis).toContain('module failed to load');
  });
});
