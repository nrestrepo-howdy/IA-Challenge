/**
 * The Prober, running real candidate modules in real worker threads.
 *
 * This is where D-3 is actually paid for. Everything else in the harness is pure
 * functions over data; this file is the one place that proves the isolation those
 * functions assume is real.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { NodeProber } from '../../src/harness/prober-node.js';
import { createL1Oracle } from '../../src/harness/l1-runtime.js';
import type { Candidate, Intent } from '../../src/contracts.js';

const intent: Intent = {
  id: 'i1',
  utterance: 'make it rain',
  allowedPrimitives: ['emitter'],
  scope: ['weather.rain'],
  contract: {
    id: 'c1',
    assertions: [],
    actions: [{ kind: 'advanceFrames', payload: 30 }],
    mutants: [],
  },
};

const candidate = (source: string): Candidate =>
  ({ id: 'c', intentId: 'i1', strategy: 'test', source });

/** A well-behaved candidate: cheap frames, visible pixels, moving state. */
const HEALTHY = `
  export async function init() {
    __VERBO_STATE__.weather = { rain: { headY: 400, particles: 4000 } };
  }
  export function frame(i) {
    __VERBO_STATE__.weather.rain.headY = 400 - i;
    __VERBO_PROBE__.reportFrame({
      gpuMs: 5.5,
      drawCalls: 12,
      pixels: new Uint8Array([10, 20, 30, 255]),
    });
  }
  export function dispose() { __VERBO_STATE__.weather = undefined; }
`;

/** Over the 16 ms budget on every frame (AC-06). */
const SLOW = `
  export function frame() {
    __VERBO_PROBE__.reportFrame({ gpuMs: 27.5, drawCalls: 9000, pixels: new Uint8Array([1, 1, 1, 255]) });
  }
`;

/** Renders nothing. The readback decides, not the module's own claim (AC-07). */
const BLACK = `
  export function frame() {
    __VERBO_PROBE__.reportFrame({ gpuMs: 3, drawCalls: 4, allBlack: false, pixels: new Uint8Array([0, 0, 0, 255]) });
  }
`;

/** Uncatchable from the main thread. Only a terminate() stops this (AC-08). */
const INFINITE = `
  export function init() { for (;;) {} }
  export function frame() {}
`;

/** An infinite loop that never even reaches init — the module body itself hangs. */
const INFINITE_TOP_LEVEL = `
  let n = 0;
  while (true) { n++; }
  export function frame() {}
`;

const THROWS_EARLY = `
  export function frame(i) {
    __VERBO_PROBE__.reportFrame({ gpuMs: 4, pixels: new Uint8Array([9, 9, 9, 255]) });
    if (i === 2) throw new Error('emitter.material is undefined');
  }
`;

let prober: NodeProber | null = null;
afterEach(async () => {
  await prober?.dispose();
  prober = null;
});

describe('AC-08 · L1 kills an infinite-loop candidate by timeout without affecting the main thread', () => {
  it('terminates the worker instead of waiting on it, and the main thread keeps ticking', async () => {
    prober = new NodeProber({ frames: 10 });

    // The proof that matters. If the candidate were running on this thread — or if the
    // prober tried to try/catch it, which is impossible for a loop — this interval
    // would stop firing and the count would stay at zero.
    let ticks = 0;
    const heartbeat = setInterval(() => { ticks++; }, 10);

    const started = Date.now();
    const result = await prober.probe(candidate(INFINITE), intent, 300);
    const elapsed = Date.now() - started;
    clearInterval(heartbeat);

    expect(result.timedOut).toBe(true);
    expect(result.crashed).toBe(false);
    expect(result.frames).toEqual([]);

    // `probe` awaits terminate(), so a settled result means the thread is gone — not
    // merely abandoned to spin behind us for the rest of the process.
    expect(prober.activeWorkers).toBe(0);

    expect(ticks).toBeGreaterThan(10);
    expect(elapsed).toBeGreaterThanOrEqual(280);
    expect(elapsed).toBeLessThan(3_000);
  });

  it('kills a module that hangs at the top level, before init is ever reachable', async () => {
    prober = new NodeProber({ frames: 10 });
    const result = await prober.probe(candidate(INFINITE_TOP_LEVEL), intent, 300);
    expect(result.timedOut).toBe(true);
    expect(prober.activeWorkers).toBe(0);
  });

  it('leaves the main thread able to do real work afterwards, including a further probe', async () => {
    prober = new NodeProber({ frames: 10 });
    await prober.probe(candidate(INFINITE), intent, 250);

    // Ordinary main-thread work still computes correctly after the kill.
    let sum = 0;
    for (let i = 0; i < 200_000; i++) sum += i;
    expect(sum).toBe(19_999_900_000);

    // And the prober is not poisoned: a healthy candidate still runs to completion.
    const after = await prober.probe(candidate(HEALTHY), intent, 5_000);
    expect(after.timedOut).toBe(false);
    expect(after.frames.length).toBe(40);
  });

  it('surfaces through L1 as a rejection, not as a hang or a thrown error', async () => {
    prober = new NodeProber({ frames: 10 });
    const oracle = createL1Oracle(prober, { timeoutMs: 300 });
    const verdict = await oracle.evaluate(candidate(INFINITE), intent);
    expect(verdict.passed).toBe(false);
    expect(verdict.failedAt).toBe('L1');
    expect(verdict.diagnosis).toMatch(/unbounded loop/);
  });
});

describe('Prober · running a candidate in isolation', () => {
  it('probes the configured frame count, then the scripted actions', async () => {
    prober = new NodeProber({ frames: 120 });
    const result = await prober.probe(candidate(HEALTHY), intent, 5_000);
    expect(result.crashed).toBe(false);
    expect(result.timedOut).toBe(false);
    // 120 probe frames plus the contract's advanceFrames(30).
    expect(result.frames.length).toBe(150);
    expect(result.frames[0]!.index).toBe(0);
  });

  it('snapshots state around the scripted actions, which is what L2 asserts over', async () => {
    prober = new NodeProber({ frames: 120 });
    const result = await prober.probe(candidate(HEALTHY), intent, 5_000);
    const before = result.stateBefore as { weather: { rain: { headY: number } } };
    const after = result.stateAfter as { weather: { rain: { headY: number } } };
    expect(before.weather.rain.headY).toBe(400 - 119);
    expect(after.weather.rain.headY).toBe(400 - 149);
  });

  it('returns the last readback as visual proof', async () => {
    prober = new NodeProber({ frames: 5 });
    const result = await prober.probe(candidate(HEALTHY), intent, 5_000);
    expect(Array.from(result.pixels!)).toEqual([10, 20, 30, 255]);
  });

  it('reports a module that exports no frame() rather than passing it', async () => {
    prober = new NodeProber({ frames: 5 });
    const result = await prober.probe(candidate('export const nothing = 1;'), intent, 5_000);
    expect(result.crashed).toBe(true);
    expect(result.crashMessage).toMatch(/frame\(index\)/);
  });

  it('reports a module that fails to import at all', async () => {
    prober = new NodeProber({ frames: 5 });
    const result = await prober.probe(candidate('export function frame( {'), intent, 5_000);
    expect(result.crashed).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it('dispose() kills workers still in flight', async () => {
    const p = new NodeProber({ frames: 10 });
    const pending = p.probe(candidate(INFINITE), intent, 10_000);
    await p.dispose();
    const result = await pending;
    // Terminating from outside surfaces as a non-zero exit, not as a silent pass.
    expect(result.timedOut === true || result.crashed === true).toBe(true);
  });
});

describe('L1 over a real worker', () => {
  it('AC-06 · rejects a real module whose median frame time exceeds 16 ms', async () => {
    prober = new NodeProber({ frames: 30 });
    const verdict = await createL1Oracle(prober, { timeoutMs: 5_000 }).evaluate(candidate(SLOW), intent);
    expect(verdict.passed).toBe(false);
    expect(verdict.failedAt).toBe('L1');
    expect(verdict.metrics.medianFrameMs).toBe(27.5);
    expect(verdict.metrics.drawCalls).toBe(9000);
    expect(verdict.diagnosis).toMatch(/Median frame time/);
  });

  it('AC-07 · rejects a real module whose readback is all black, whatever the module claims', async () => {
    prober = new NodeProber({ frames: 30 });
    const verdict = await createL1Oracle(prober, { timeoutMs: 5_000 }).evaluate(candidate(BLACK), intent);
    expect(verdict.passed).toBe(false);
    expect(verdict.diagnosis).toMatch(/black/);
  });

  it('rejects a module that throws during its first frames', async () => {
    prober = new NodeProber({ frames: 30 });
    const verdict = await createL1Oracle(prober, { timeoutMs: 5_000 }).evaluate(candidate(THROWS_EARLY), intent);
    expect(verdict.passed).toBe(false);
    expect(verdict.failedAt).toBe('L1');
    expect(verdict.diagnosis).toContain('emitter.material is undefined');
  });

  it('passes a healthy module and reports medianFrameMs and drawCalls', async () => {
    prober = new NodeProber({ frames: 120 });
    const verdict = await createL1Oracle(prober, { timeoutMs: 5_000 }).evaluate(candidate(HEALTHY), intent);
    expect(verdict.passed).toBe(true);
    expect(verdict.failedAt).toBe(null);
    expect(verdict.diagnosis).toBe(null);
    expect(verdict.metrics.medianFrameMs).toBe(5.5);
    expect(verdict.metrics.drawCalls).toBe(12);
    expect(verdict.frame).not.toBe(null);
  });
});
