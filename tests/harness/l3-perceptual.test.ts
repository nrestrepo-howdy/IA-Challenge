import { describe, it, expect } from 'vitest';
import { pixelDelta, evaluateL3, type Frame, type VisualCritic } from '../../src/harness/l3-perceptual.js';
import { isInjectable } from '../../src/harness/cascade.js';

const frame = (w: number, h: number, fill: (i: number) => [number, number, number]): Frame => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const [r, g, b] = fill(p);
    data[p * 4] = r; data[p * 4 + 1] = g; data[p * 4 + 2] = b; data[p * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
};

const dark = frame(20, 20, () => [4, 5, 6]);
const lit = frame(20, 20, (i) => (i < 200 ? [180, 190, 200] : [4, 5, 6]));

describe('L3 · pixel delta', () => {
  it('reports no change between identical frames', () => {
    expect(pixelDelta(dark, dark).changed).toBe(0);
  });

  it('ignores sub-threshold drift, so antialiasing is not read as motion', () => {
    const jittered = frame(20, 20, () => [7, 8, 9]);
    expect(pixelDelta(dark, jittered).changed).toBe(0);
  });

  it('measures the changed fraction', () => {
    expect(pixelDelta(dark, lit).changed).toBeCloseTo(200 / 400, 5);
  });

  it('reports coverage separately from change', () => {
    expect(pixelDelta(dark, lit).coverage).toBeCloseTo(0.5, 5);
    expect(pixelDelta(dark, dark).coverage).toBe(0);
  });

  it('refuses to compare frames of different sizes rather than guessing', () => {
    expect(() => pixelDelta(dark, frame(10, 10, () => [0, 0, 0]))).toThrow(/frame size changed/);
  });
});

describe('AC-11 · L3 is advisory, and says what it did not check', () => {
  it('rejects a candidate that satisfied its contract but rendered nothing', async () => {
    const v = await evaluateL3(dark, dark, 'make it rain');
    expect(v.failedAt).toBe('L3');
    expect(v.diagnosis).toMatch(/nothing became visible/);
  });

  it('passes without a critic, and does not pretend appearance was judged', async () => {
    const v = await evaluateL3(dark, lit, 'make it rain');
    expect(v.passed).toBe(true);
    expect(v.diagnosis).toMatch(/no visual critic configured/);
  });

  it('does not consult the critic when nothing changed — the cheap gate runs first', async () => {
    let consulted = false;
    const critic: VisualCritic = {
      async judge() { consulted = true; return { satisfied: true, note: 'fine' }; },
    };
    await evaluateL3(dark, dark, 'make it rain', { critic });
    expect(consulted).toBe(false);
  });

  it('relays the critic judgement as prose a repair agent can act on', async () => {
    const critic: VisualCritic = {
      async judge() { return { satisfied: false, note: 'it rains, but the drops pass through the terrain' }; },
    };
    const v = await evaluateL3(dark, lit, 'make it rain', { critic });
    expect(v.passed).toBe(false);
    expect(v.diagnosis).toBe('it rains, but the drops pass through the terrain');
  });
});

describe('AC-11 · a dissatisfied critic does not prevent injection', () => {
  const displeased: VisualCritic = {
    async judge() { return { satisfied: false, note: 'the rain is there but far too sparse to read as rain' }; },
  };

  it('produces an L3-only failure, which the injection gate still admits', async () => {
    const l3 = await evaluateL3(dark, lit, 'make it rain', { critic: displeased });
    expect(l3.passed).toBe(false);
    expect(l3.failedAt).toBe('L3');
    // The gate, not a restatement of it: taste is advisory, and this is the whole
    // reason the critic is allowed to have an opinion at all.
    expect(isInjectable({ ...l3, candidateId: 'c1', frame: null })).toBe(true);
  });

  it('carries the critic note through as the diagnosis a repair agent reads', async () => {
    const l3 = await evaluateL3(dark, lit, 'make it rain', { critic: displeased });
    expect(l3.diagnosis).toMatch(/too sparse/);
    expect(l3.diagnosis).not.toMatch(/\d+(\.\d+)?\s*(\/|out of)/);
  });
});
