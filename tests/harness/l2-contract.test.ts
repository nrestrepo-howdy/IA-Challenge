import { describe, it, expect } from 'vitest';
import { evaluateContract, checkAssertion, toVerdict } from '../../src/harness/l2-contract.js';
import type { Assertion, StateContract } from '../../src/contracts.js';

const rainContract: StateContract = {
  id: 'rain',
  assertions: [
    { id: 'a-exists', path: 'weather.rain', kind: 'exists' },
    { id: 'a-count', path: 'weather.rain.particles', kind: 'inRange', min: 100, max: 20000 },
    { id: 'a-moves', path: 'weather.rain.headY', kind: 'changesOverTime', window: 30 },
    {
      id: 'a-bounded', path: 'weather.rain.bounds', kind: 'boundedBy',
      expected: { min: [-500, -10, -500], max: [500, 400, 500] },
    },
  ],
  actions: [{ kind: 'advanceFrames', payload: 30 }],
  mutants: [],
};

const before = { weather: { rain: { particles: 4000, headY: 300, bounds: [0, 100, 0] } } };
const after = { weather: { rain: { particles: 4000, headY: 240, bounds: [0, 80, 0] } } };

describe('AC-09 · L2 rejects a candidate that does not satisfy its state contract', () => {
  it('passes a correct implementation', () => {
    const out = evaluateContract(rainContract, before, after);
    expect(out.passed).toBe(true);
    expect(out.failedIds).toEqual([]);
  });

  it('catches state that is present but inert — the dominant failure mode', () => {
    const inert = { weather: { rain: { particles: 4000, headY: 300, bounds: [0, 100, 0] } } };
    const out = evaluateContract(rainContract, before, inert);
    expect(out.passed).toBe(false);
    expect(out.failedIds).toContain('a-moves');
  });

  it('catches schema drift — the field the contract needs stops existing', () => {
    const drifted = { weather: { rain: { count: 4000, headY: 240, bounds: [0, 80, 0] } } };
    const out = evaluateContract(rainContract, before, drifted);
    expect(out.failedIds).toContain('a-count');
  });

  it('catches values that escaped the world volume', () => {
    const escaped = { weather: { rain: { particles: 4000, headY: 240, bounds: [0, 9999, 0] } } };
    const out = evaluateContract(rainContract, before, escaped);
    expect(out.failedIds).toContain('a-bounded');
  });

  it('reports which assertions passed, and names the failures', () => {
    const out = evaluateContract(rainContract, before, { weather: {} });
    const v = toVerdict(out);
    expect(v.failedAt).toBe('L2');
    expect(v.metrics.assertionsTotal).toBe(4);
    expect(v.diagnosis).toContain('a-exists');
  });
});

describe('L2 · assertion semantics', () => {
  it('inRange rejects a non-numeric value rather than coercing it', () => {
    const a: Assertion = { id: 'x', path: 'n', kind: 'inRange', min: 0, max: 10 };
    expect(checkAssertion(a, {}, { n: '5' }).passed).toBe(false);
  });

  it('changesOverTime fails on an absent path instead of passing vacuously', () => {
    const a: Assertion = { id: 'x', path: 'gone', kind: 'changesOverTime' };
    const r = checkAssertion(a, { gone: 1 }, {});
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('absent');
  });
});
