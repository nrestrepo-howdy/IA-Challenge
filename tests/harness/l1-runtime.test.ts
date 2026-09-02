/**
 * L1 verdict semantics, tested against synthetic probe results.
 *
 * No worker here on purpose: the rule and the machinery that feeds it are separate
 * failure modes, and a test should be able to say which one broke. The worker itself
 * is exercised in prober-node.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { verdictFromProbe, createL1Oracle, FRAME_BUDGET_MS } from '../../src/harness/l1-runtime.js';
import type { Candidate, FrameSample, Intent, ProbeResult } from '../../src/contracts.js';

const intent: Intent = {
  id: 'i1',
  utterance: 'make it rain',
  allowedPrimitives: ['emitter'],
  scope: ['weather.rain'],
  contract: { id: 'c1', assertions: [], actions: [], mutants: [] },
};

const candidate: Candidate = { id: 'c', intentId: 'i1', strategy: 'test', source: '' };

const frames = (count: number, gpuMs: number, allBlack = false): FrameSample[] =>
  Array.from({ length: count }, (_, index) => ({ index, gpuMs, allBlack }));

/** The two fields the prober adds structurally; see `NodeProbeResult`. */
type ProbeOver = Partial<ProbeResult> & { drawCalls?: number | null; crashMessage?: string | null };

const probe = (over: ProbeOver): ProbeResult => ({
  crashed: false,
  timedOut: false,
  frames: frames(120, 4),
  stateBefore: null,
  stateAfter: null,
  pixels: null,
  ...over,
});

describe('AC-06 · L1 rejects a module whose median frame time exceeds 16 ms', () => {
  it('passes a module comfortably inside the budget', () => {
    const v = verdictFromProbe(probe({ frames: frames(120, 6.5) }));
    expect(v.passed).toBe(true);
    expect(v.failedAt).toBe(null);
    expect(v.metrics.medianFrameMs).toBe(6.5);
  });

  it('rejects a module over the budget and names the layer', () => {
    const v = verdictFromProbe(probe({ frames: frames(120, 22.4) }));
    expect(v.passed).toBe(false);
    expect(v.failedAt).toBe('L1');
    expect(v.metrics.medianFrameMs).toBe(22.4);
  });

  it('judges by median, so a few warm-up hitches do not condemn a fast module', () => {
    // Ten catastrophic frames, 110 fast ones: the median is what the user feels.
    const mixed = [...frames(10, 90), ...frames(110, 5)].map((f, index) => ({ ...f, index }));
    expect(verdictFromProbe(probe({ frames: mixed })).passed).toBe(true);
  });

  it('does not let fast frames average away a genuinely slow module', () => {
    // Mean would be ~13 ms and pass; the median is 40 ms and the world stutters.
    const bimodal = [...frames(70, 40), ...frames(50, 1)].map((f, index) => ({ ...f, index }));
    const v = verdictFromProbe(probe({ frames: bimodal }));
    expect(v.passed).toBe(false);
    expect(v.metrics.medianFrameMs).toBe(40);
  });

  it('sits exactly on the budget without rejecting — the constraint is "exceeds"', () => {
    expect(verdictFromProbe(probe({ frames: frames(120, FRAME_BUDGET_MS) })).passed).toBe(true);
  });

  it('diagnoses in actionable prose, not a score', () => {
    const v = verdictFromProbe(probe({ frames: frames(120, 22.4) }));
    expect(v.diagnosis).toMatch(/16 ms budget/);
    expect(v.diagnosis).toMatch(/particle count|draw calls|compute pass/);
  });
});

describe('AC-07 · L1 rejects a module that produces an all-black frame', () => {
  it('rejects when any probed frame is black', () => {
    const withBlack = frames(120, 4).map((f) => (f.index === 3 ? { ...f, allBlack: true } : f));
    const v = verdictFromProbe(probe({ frames: withBlack }));
    expect(v.passed).toBe(false);
    expect(v.failedAt).toBe('L1');
    expect(v.diagnosis).toMatch(/black/);
  });

  it('points at R-5 — the un-awaited init that ships a black first frame', () => {
    const v = verdictFromProbe(probe({ frames: frames(120, 4, true) }));
    expect(v.diagnosis).toMatch(/init\(\) is awaited/);
  });

  it('rejects blackness ahead of the frame budget, since a blank module has no cost worth reporting', () => {
    const v = verdictFromProbe(probe({ frames: frames(120, 40, true) }));
    expect(v.diagnosis).toMatch(/black/);
    expect(v.diagnosis).not.toMatch(/budget/);
  });

  it('still reports the metrics it measured, so the repair agent sees the whole picture', () => {
    const v = verdictFromProbe(probe({ frames: frames(120, 4, true), drawCalls: 12 }));
    expect(v.metrics.medianFrameMs).toBe(4);
    expect(v.metrics.drawCalls).toBe(12);
  });
});

describe('L1 · runtime failures that are not slowness', () => {
  it('AC-08 · a timed-out probe becomes an L1 rejection naming the unbounded loop', () => {
    const v = verdictFromProbe(probe({ timedOut: true, frames: [] }));
    expect(v.passed).toBe(false);
    expect(v.failedAt).toBe('L1');
    expect(v.diagnosis).toMatch(/unbounded loop/);
  });

  it('rejects a module that throws during its first frames, and quotes the exception', () => {
    const v = verdictFromProbe(
      probe({ crashed: true, crashMessage: 'emitter is undefined', frames: frames(2, 4) }),
    );
    expect(v.passed).toBe(false);
    expect(v.failedAt).toBe('L1');
    expect(v.diagnosis).toContain('emitter is undefined');
  });

  it('rejects a module that reports nothing rather than passing vacuously', () => {
    const v = verdictFromProbe(probe({ frames: [] }));
    expect(v.passed).toBe(false);
    expect(v.diagnosis).toMatch(/reportFrame/);
  });

  it('rejects a module over the draw-call budget', () => {
    const v = verdictFromProbe(probe({ drawCalls: 4000 }));
    expect(v.passed).toBe(false);
    expect(v.diagnosis).toMatch(/draw calls/);
  });

  it('reports medianFrameMs and drawCalls in the verdict metrics', () => {
    const v = verdictFromProbe(probe({ frames: frames(120, 7), drawCalls: 31 }));
    expect(v.metrics.medianFrameMs).toBe(7);
    expect(v.metrics.drawCalls).toBe(31);
  });

  it('carries the readback through as the verdict frame — visual proof of the rejection', () => {
    const pixels = new Uint8Array([0, 0, 0, 255]);
    const v = verdictFromProbe(probe({ frames: frames(120, 4, true), pixels }));
    expect(v.frame).toBe(pixels);
  });
});

describe('L1 · the Prober seam', () => {
  it('depends only on the Prober interface, so a browser prober drops in unchanged', async () => {
    let sawTimeout: number | null = null;
    const stub = {
      async probe(_c: Candidate, _i: Intent, timeoutMs: number): Promise<ProbeResult> {
        sawTimeout = timeoutMs;
        return probe({ frames: frames(120, 3) });
      },
    };
    const oracle = createL1Oracle(stub, { timeoutMs: 750 });
    expect(oracle.layer).toBe('L1');
    const v = await oracle.evaluate(candidate, intent);
    expect(v.passed).toBe(true);
    expect(sawTimeout).toBe(750);
  });

  it('honours an intent-specific frame budget', async () => {
    const stub = { async probe(): Promise<ProbeResult> { return probe({ frames: frames(120, 9) }); } };
    const strict = createL1Oracle(stub, { frameBudgetMs: 8 });
    expect((await strict.evaluate(candidate, intent)).passed).toBe(false);
  });
});
