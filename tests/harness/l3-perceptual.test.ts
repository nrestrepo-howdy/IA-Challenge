import { describe, it, expect } from 'vitest';
import { pixelDelta, evaluateL3, type Frame, type VisualCritic } from '../../src/harness/l3-perceptual.js';

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
