/**
 * The autonomous repair loop, closed and shown closing.
 *
 * This file is the evidence for one claim: **attempt N+1 is informed by why attempt N
 * failed**, with nobody in the room. Everything else in the suite proves a part works;
 * this proves the parts feed each other.
 *
 * The loop under test is the real one — the real templates in `generate.ts`, the real
 * `rulesRepairAgent`, the real bounded `runCycle`. Only the oracle is a stand-in, and
 * it stands in for a measurement, not for a judgement: it reads the particle count out
 * of the module the generator actually emitted and rejects it the way L1 rejects a
 * candidate that blows the frame budget (AC-06). Reading the count from the *source*
 * rather than from the intent is deliberate — it is the only way to prove the repair
 * reached the generated code, and not merely the guidance object.
 *
 * The story it tells, in order:
 *
 *   attempt 1  brief says count: 12000  ->  all three candidates rejected at L1,
 *              each with a diagnosis naming the budget it blew
 *   repair     rulesRepairAgent reads three L1 diagnoses, and L1 is the one layer whose
 *              direction is unambiguous: less work per frame. It halves every numeric
 *              parameter and rotates the strategy order.
 *   attempt 2  brief says count: 6000   ->  under budget, cleared, injected
 *
 * No human input in between, and no attempt-2 candidate is byte-identical to an
 * attempt-1 candidate — which is the whole difference between this and the retry loop
 * that was here before.
 */
import { describe, it, expect } from 'vitest';
import type { Candidate, Intent, Oracle, Verdict } from '../../src/contracts.js';
import { World } from '../../src/core/world.js';
import { MAX_ATTEMPTS, runCycle } from '../../src/runtime/cycle.js';
import { rulesRepairAgent, type RepairAgent, type RepairRequest } from '../../src/runtime/agents.js';
import { applyGuidance, generateCandidates, templateGenerator } from '../../src/runtime/generate.js';
import { HotInjector } from '../../src/runtime/injector.js';
import type { LoadedModule } from '../../src/runtime/loader.js';
import { makeIntent } from '../fixtures.js';
import { fakeClock, stubModule, StubModuleLoader } from './support.js';

const noMetrics = {
  compileMs: null,
  medianFrameMs: null,
  drawCalls: null,
  pixelDelta: null,
  assertionsPassed: 0,
  assertionsTotal: 0,
} as const;

/** A brief the templates can actually emit, carrying a count that is over budget. */
const intent: Intent = makeIntent({
  id: 'i-rain',
  utterance: 'make it rain',
  allowedPrimitives: ['rain-emitter', 'wind-field'],
  scope: ['weather.rain', 'forces.wind'],
  brief: {
    goal: 'fill the sky with falling rain',
    rationale: 'the request names precipitation and the catalogue has an emitter for it',
    // Two directives, so `reversedStrategy` is a genuinely different program from
    // `directStrategy` rather than the same one with the same single mount in it.
    directives: [
      {
        name: 'rain-emitter',
        importSpecifier: 'verbo:rain-emitter',
        statePath: 'weather.rain',
        params: { count: 12000, speed: 24 },
      },
      {
        name: 'wind-field',
        importSpecifier: 'verbo:wind-field',
        statePath: 'forces.wind',
        params: { strength: 6, direction: [0.7, 0, 0.7] },
      },
    ],
    steps: [],
    constraints: [],
  },
});

/** The count the module was emitted with, read back out of the module itself. */
function countInSource(source: string): number {
  const found = /"count":(\d+)/.exec(source);
  if (found === null) throw new Error(`no count in the emitted module:\n${source}`);
  return Number(found[1]);
}

/**
 * L1's complaint, made deterministic: above this many particles the frame budget goes.
 *
 * 8000 sits between the brief's 12000 and the 6000 a halving produces, so the repair
 * has to move the number the right way *and* far enough. A test that passed on any
 * change at all would prove the loop is different, not that it is repairing.
 */
const AFFORDABLE = 8000;

function budgetOracle(): Oracle {
  return {
    layer: 'L1',
    budgetMs: 10,
    async evaluate(c: Candidate): Promise<Omit<Verdict, 'candidateId'>> {
      const count = countInSource(c.source);
      const ms = (count / AFFORDABLE) * 16;
      if (ms <= 16) {
        return { passed: true, failedAt: null, diagnosis: null, frame: null, metrics: noMetrics };
      }
      return {
        passed: false,
        failedAt: 'L1',
        // Actionable text: it names the parameter, the measurement and the direction.
        diagnosis:
          `median frame ${ms.toFixed(1)} ms exceeds the 16 ms budget with count ${count}; ` +
          'the emitter is drawing more particles per frame than the budget affords',
        frame: null,
        metrics: { ...noMetrics, medianFrameMs: ms },
      };
    },
  };
}

/** Records what the repair agent was asked and what it answered, without changing either. */
function observedRepair(inner: RepairAgent = rulesRepairAgent) {
  const seen: RepairRequest[] = [];
  return {
    seen,
    async repair(request: RepairRequest) {
      seen.push(request);
      return inner.repair(request);
    },
  };
}

function liveWorld() {
  const world = new World();
  const loader = new StubModuleLoader(new Map<string, LoadedModule>());
  const injector = new HotInjector({ world, loader, now: fakeClock(1_000).now });
  return { world, loader, injector };
}

describe('AC-19 · the retry loop is a repair loop: attempt N+1 is informed by attempt N', () => {
  it('fails on cost, repairs the parameter that caused it, and succeeds unattended', async () => {
    const repair = observedRepair();
    const { world, loader, injector } = liveWorld();
    // Only attempt 2's candidates can be loaded, which is a second, independent way of
    // saying that attempt 1 must not be what reaches the world.
    for (const c of generateCandidates(intent, 1, null)) {
      loader.set(c.id, stubModule(world, { id: c.strategy, statePath: 'weather.rain' }).module);
    }

    const result = await runCycle(intent, {
      generator: templateGenerator,
      oracles: [budgetOracle()],
      injector,
      repair,
    });

    // ── what failed ───────────────────────────────────────────────────────────────
    const first = repair.seen[0];
    expect(first?.attempt).toBe(1);
    expect(first?.failures).toHaveLength(3);
    for (const failure of first?.failures ?? []) {
      expect(failure.failedAt).toBe('L1');
      expect(failure.diagnosis).toContain('count 12000');
    }

    // ── what changed ──────────────────────────────────────────────────────────────
    // Not "the ids differ": the repaired brief carries a different number, and the
    // parameter it moved is the one the diagnosis complained about.
    const guidance = await rulesRepairAgent.repair(first as RepairRequest);
    const repaired = applyGuidance(intent.brief, guidance);
    expect(intent.brief.directives[0]?.params['count']).toBe(12000);
    expect(repaired.directives[0]?.params['count']).toBe(6000);

    const attempt1 = generateCandidates(intent, 0, null).map((c) => c.source);
    const attempt2 = generateCandidates(intent, 1, guidance).map((c) => c.source);
    for (const source of attempt2) expect(attempt1).not.toContain(source);

    // ── why it passed ─────────────────────────────────────────────────────────────
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.report);
    expect(result.attempts).toBe(2);
    expect(countInSource(result.candidate.source)).toBe(6000);
    expect(countInSource(result.candidate.source)).toBeLessThanOrEqual(AFFORDABLE);
    expect(world.snapshot().verbs.map((v) => v.utterance)).toEqual(['make it rain']);
    // One repair, not one per attempt: the loop stopped because it worked.
    expect(repair.seen).toHaveLength(1);
  });

  it('still terminates and reports when no parameter can rescue the candidates', async () => {
    const repair = observedRepair();
    const { injector } = liveWorld();
    // Nothing is affordable, so every repair is answered with another rejection. The
    // bound is the loop's shape, not a timeout someone has to get right.
    const impossible: Oracle = {
      layer: 'L1',
      budgetMs: 10,
      async evaluate(c: Candidate) {
        return {
          passed: false,
          failedAt: 'L1' as const,
          diagnosis: `count ${countInSource(c.source)} is over budget at any size`,
          frame: null,
          metrics: noMetrics,
        };
      },
    };

    const result = await runCycle(intent, {
      generator: templateGenerator,
      oracles: [impossible],
      injector,
      repair,
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(MAX_ATTEMPTS);
    expect(repair.seen).toHaveLength(MAX_ATTEMPTS);
    if (result.ok) throw new Error('expected the cycle to give up');
    // It gives up out loud, naming every attempt and every diagnosis.
    expect(result.report).toContain('AC-19');
    expect(result.report).toContain('count 12000');
    expect(result.report).toContain('count 6000');
    expect(result.report).toContain('count 3000');
  });

  it('offline, with no key and no client, still varies the candidates between attempts', async () => {
    // The browser cycle has no API key by construction, so this is the path the live
    // demo actually takes. The floor beneath the model must still make a retry a
    // different program, or the loop is decorative.
    const emitted: string[][] = [];
    let guidance = null as Awaited<ReturnType<RepairAgent['repair']>> | null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const candidates = generateCandidates(intent, attempt, guidance);
      emitted.push(candidates.map((c) => c.source));
      guidance = await rulesRepairAgent.repair({
        intent,
        attempt: attempt + 1,
        failures: candidates.map((c) => ({
          candidateId: c.id,
          strategy: c.strategy,
          failedAt: 'L1' as const,
          diagnosis: `count ${countInSource(c.source)} exceeds the frame budget`,
        })),
      });
    }

    const flat = emitted.flat();
    expect(new Set(flat).size).toBe(flat.length);
    expect(emitted.map((sources) => countInSource(sources[0] as string))).toEqual([12000, 6000, 3000]);
  });
});
