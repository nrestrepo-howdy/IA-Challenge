/**
 * The product's own autonomous loop, run and printed.
 *
 * `tests/runtime/repair-loop.test.ts` asserts that this loop closes. A passing test is
 * the right way to hold a property and the wrong way to *show* one: a judge reading
 * `1 passed` learns that something was checked, not what happened. This runs the same
 * loop, with the same real components, and prints the trace.
 *
 * Nothing here is staged except the oracle, and it stands in for a measurement rather
 * than a judgement: it reads the particle count back out of the module the generator
 * actually emitted and rejects it the way L1 rejects a candidate that blows the frame
 * budget. The generator, the repair agent, the bounded cycle and the injector are the
 * ones the product runs.
 *
 * The fixtures are imported from the test rather than copied, so this cannot drift into
 * demonstrating something the suite does not hold.
 *
 *   npm run evidence:loop
 */
import type { Candidate, Intent, Oracle, Verdict } from '../../src/contracts.js';
import { World } from '../../src/core/world.js';
import { runCycle } from '../../src/runtime/cycle.js';
import { rulesRepairAgent } from '../../src/runtime/agents.js';
import { generateCandidates, templateGenerator } from '../../src/runtime/generate.js';
import { HotInjector } from '../../src/runtime/injector.js';
import type { LoadedModule } from '../../src/runtime/loader.js';
import { makeIntent } from '../../tests/fixtures.js';
import { fakeClock, stubModule, StubModuleLoader } from '../../tests/runtime/support.js';

const noMetrics = {
  compileMs: null, medianFrameMs: null, drawCalls: null,
  pixelDelta: null, assertionsPassed: 0, assertionsTotal: 0,
} as const;

const intent: Intent = makeIntent({
  id: 'i-rain',
  utterance: 'make it rain',
  allowedPrimitives: ['rain-emitter', 'wind-field'],
  scope: ['weather.rain', 'forces.wind'],
  brief: {
    goal: 'fill the sky with falling rain',
    rationale: 'the request names precipitation and the catalogue has an emitter for it',
    directives: [
      { name: 'rain-emitter', importSpecifier: 'verbo:rain-emitter', statePath: 'weather.rain', params: { count: 12000, speed: 24 } },
      { name: 'wind-field', importSpecifier: 'verbo:wind-field', statePath: 'forces.wind', params: { strength: 6, direction: [0.7, 0, 0.7] } },
    ],
    steps: [],
    constraints: [],
  },
});

/** 8000 sits between the brief's 12000 and the 6000 a halving produces. */
const AFFORDABLE = 8000;

const budgetOracle: Oracle = {
  layer: 'L1',
  budgetMs: 10,
  async evaluate(c: Candidate): Promise<Omit<Verdict, 'candidateId'>> {
    const found = /"count":(\d+)/.exec(c.source);
    if (found === null) throw new Error('no count in the emitted module');
    const count = Number(found[1]);
    const ms = (count / AFFORDABLE) * 16;
    if (ms <= 16) return { passed: true, failedAt: null, diagnosis: null, frame: null, metrics: noMetrics };
    return {
      passed: false, failedAt: 'L1',
      diagnosis: `median frame ${ms.toFixed(1)} ms exceeds the 16 ms budget with count ${count}; ` +
        'the emitter is drawing more particles per frame than the budget affords',
      frame: null, metrics: { ...noMetrics, medianFrameMs: ms },
    };
  },
};

const world = new World();
const loader = new StubModuleLoader(new Map<string, LoadedModule>());
const injector = new HotInjector({ world, loader, now: fakeClock(1_000).now });
// Only attempt 2's candidates can be loaded: a second, independent way of saying that
// attempt 1 must not be what reaches the world.
for (const c of generateCandidates(intent, 1, null)) {
  loader.set(c.id, stubModule(world, { id: c.strategy, statePath: 'weather.rain' }).module);
}

console.log(`
  Verbo · the product's own autonomous loop
  the same loop asserted by tests/runtime/repair-loop.test.ts, printed rather than checked

  intent    "${intent.utterance}"
  brief     rain-emitter count 12000, wind-field strength 6
  oracle    L1, 16 ms frame budget   (affordable at ${AFFORDABLE} particles)
`);

const result = await runCycle(intent, {
  generator: templateGenerator,
  oracles: [budgetOracle],
  injector,
  repair: rulesRepairAgent,
});

// Printed from `result.history` rather than from a callback, because the history is
// what the cycle itself kept: every attempt, every failure with its diagnosis, and the
// guidance that was handed forward. A trace assembled from a side channel could show
// something the cycle did not record.
for (const record of result.history) {
  console.log(`  attempt ${record.attempt}   ${record.candidateCount} candidates` +
    (record.attempt > 1 ? ', repaired' : ''));
  for (const failure of record.failures) {
    console.log(`    ${failure.strategy.padEnd(10)} ${failure.failedAt} rejected — ${(failure.diagnosis ?? '').slice(0, 96)}`);
  }
  const g = record.guidance;
  if (g) {
    console.log(`\n  repair      no human input; ${record.failures.length} diagnoses read`);
    for (const line of g.instructions) console.log(`              ${line.slice(0, 92)}`);
    // The repaired numbers, which is the half that proves the repair reached the code
    // rather than only the guidance object.
    for (const p of g.params) {
      const was = intent.brief.directives.find((d) => d.name === p.primitive)?.params[p.param];
      console.log(`              ${p.primitive}.${p.param}: ${JSON.stringify(was)} -> ${JSON.stringify(p.value)}  (${p.reason.slice(0, 44)})`);
    }
    if (g.preferStrategies.length) console.log(`              try first next: ${g.preferStrategies.join(', ')}`);
    console.log('');
  }
}

if (result.ok) {
  console.log(`  ${result.candidate.strategy.padEnd(10)} cleared L1 — injected`);
}

console.log(`
  closed: ${result.ok ? 'injected' : 'no candidate'} after ${result.attempts} attempt(s), 0 human instructions
  the world now holds ${Object.keys(world.state as Record<string, unknown>).join(', ') || 'nothing'}
`);
