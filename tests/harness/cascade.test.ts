import { describe, it, expect } from 'vitest';
import { runCascade, isInjectable, AUTHORITATIVE_LAYERS, firstInjectable } from '../../src/harness/cascade.js';
import type { Candidate, Intent, Layer, Oracle, Verdict } from '../../src/contracts.js';

const intent: Intent = {
  id: 'i1', utterance: 'make it rain', allowedPrimitives: ['emitter'],
  scope: ['weather.rain'], contract: { id: 'c', assertions: [], actions: [], mutants: [] },
};
const candidate: Candidate = { id: 'cand-1', intentId: 'i1', strategy: 's', source: '' };

const noMetrics = {
  compileMs: null, medianFrameMs: null, drawCalls: null,
  pixelDelta: null, assertionsPassed: 0, assertionsTotal: 0,
} as const;

/** Records execution order so short-circuiting is observable, not assumed. */
function fakeOracle(layer: Layer, passed: boolean, log: Layer[]): Oracle {
  return {
    layer, budgetMs: 10,
    async evaluate() {
      log.push(layer);
      return { passed, failedAt: passed ? null : layer, diagnosis: passed ? null : `${layer} says no`, metrics: noMetrics, frame: null };
    },
  };
}

const verdict = (failedAt: Layer | null, passed: boolean): Verdict =>
  ({ candidateId: 'c', passed, failedAt, diagnosis: null, metrics: noMetrics, frame: null });

describe('AC-11 · L3 can never approve on its own', () => {
  it.each(AUTHORITATIVE_LAYERS)('a candidate failing %s is not injectable', (layer) => {
    expect(isInjectable(verdict(layer, false))).toBe(false);
  });

  it('an L3-only failure does not block injection — taste is advisory', () => {
    expect(isInjectable(verdict('L3', false))).toBe(true);
  });

  it('a candidate failing L2 stays uninjectable even when L3 approves', async () => {
    const log: Layer[] = [];
    const { verdict: v } = await runCascade(
      [fakeOracle('L0', true, log), fakeOracle('L1', true, log),
       fakeOracle('L2', false, log), fakeOracle('L3', true, log)],
      candidate, intent,
    );
    expect(v.failedAt).toBe('L2');
    expect(isInjectable(v)).toBe(false);
    // L3 never even ran: there was nothing left for it to rescue.
    expect(log).not.toContain('L3');
  });

  it('passing every layer is injectable', async () => {
    const log: Layer[] = [];
    const { verdict: v } = await runCascade(
      (['L0', 'L1', 'L2', 'L3'] as Layer[]).map((l) => fakeOracle(l, true, log)),
      candidate, intent,
    );
    expect(isInjectable(v)).toBe(true);
    expect(log).toEqual(['L0', 'L1', 'L2', 'L3']);
  });
});

describe('cascade · short-circuiting is the latency budget', () => {
  it('stops at the first authoritative rejection', async () => {
    const log: Layer[] = [];
    const { executed } = await runCascade(
      [fakeOracle('L0', false, log), fakeOracle('L1', true, log),
       fakeOracle('L2', true, log), fakeOracle('L3', true, log)],
      candidate, intent,
    );
    expect(executed).toEqual(['L0']);
    expect(log).toEqual(['L0']);
  });

  it('runs layers cheapest-first regardless of the order supplied', async () => {
    const log: Layer[] = [];
    await runCascade(
      [fakeOracle('L3', true, log), fakeOracle('L0', true, log), fakeOracle('L2', true, log), fakeOracle('L1', true, log)],
      candidate, intent,
    );
    expect(log).toEqual(['L0', 'L1', 'L2', 'L3']);
  });

  it('refuses to pass a candidate when no oracle ran', async () => {
    await expect(runCascade([], candidate, intent)).rejects.toThrow(/cannot pass by default/);
  });

  it('attributes the verdict to the layer that actually rejected', async () => {
    const log: Layer[] = [];
    const { verdict: v } = await runCascade(
      [fakeOracle('L0', true, log), fakeOracle('L1', false, log)], candidate, intent,
    );
    expect(v.failedAt).toBe('L1');
    expect(v.diagnosis).toBe('L1 says no');
    expect(v.candidateId).toBe('cand-1');
  });
});

describe('D-5 · three candidates race, first injectable wins', () => {
  const run = (layer: Layer | null, passed: boolean) => async (): Promise<any> => ({
    verdict: { ...verdict(layer, passed) }, executed: [], totalMs: 1,
  });

  it('returns the first injectable candidate', async () => {
    const { winner } = await firstInjectable([run('L1', false)(), run(null, true)(), run('L0', false)()]);
    expect(winner?.verdict.passed).toBe(true);
  });

  it('returns every verdict when all fail, so repair sees the whole picture', async () => {
    const { winner, all } = await firstInjectable([run('L0', false)(), run('L2', false)(), run('L1', false)()]);
    expect(winner).toBeNull();
    expect(all.map((r) => r.verdict.failedAt)).toEqual(['L0', 'L2', 'L1']);
  });
});
