import { describe, it, expect } from 'vitest';
import { hardenContract, applyMutant } from '../../src/harness/mutation.js';
import type { StateContract } from '../../src/contracts.js';

const before = { weather: { rain: { particles: 4000, headY: 300 } } };
const after = { weather: { rain: { particles: 4000, headY: 240 } } };

const sound: StateContract = {
  id: 'rain',
  assertions: [
    { id: 'a-count', path: 'weather.rain.particles', kind: 'inRange', min: 100, max: 20000 },
    { id: 'a-moves', path: 'weather.rain.headY', kind: 'changesOverTime', window: 30 },
  ],
  actions: [],
  mutants: [
    { id: 'm-inert', kind: 'dropStateUpdate', mustBeCaughtBy: 'a-moves' },
    { id: 'm-corrupt', kind: 'corruptConstant', mustBeCaughtBy: 'a-count' },
    { id: 'm-drift', kind: 'swapEventTarget', mustBeCaughtBy: 'a-count' },
  ],
};

describe('AC-10 · a contract that fails to catch its mutants is discarded', () => {
  it('accepts a contract that catches every sibling mutant', () => {
    const r = hardenContract(sound, before, after);
    expect(r.hardened).toBe(true);
    expect(r.escaped).toEqual([]);
    expect(r.caught).toHaveLength(3);
  });

  it('rejects a contract whose assertions are too weak to catch its own mutants', () => {
    const weak: StateContract = {
      ...sound,
      // 'exists' survives every mutation that keeps the field present.
      assertions: [{ id: 'a-count', path: 'weather.rain.particles', kind: 'exists' }],
      mutants: [{ id: 'm-corrupt', kind: 'corruptConstant', mustBeCaughtBy: 'a-count' }],
    };
    const r = hardenContract(weak, before, after);
    expect(r.hardened).toBe(false);
    expect(r.escaped).toContain('m-corrupt');
    expect(r.reason).toContain('not sound');
  });

  it('rejects a mutant nominating an assertion that does not exist', () => {
    const bad: StateContract = {
      ...sound,
      mutants: [{ id: 'm-ghost', kind: 'dropStateUpdate', mustBeCaughtBy: 'a-nonexistent' }],
    };
    expect(hardenContract(bad, before, after).hardened).toBe(false);
  });

  it('requires the nominated assertion to fire — not merely some assertion', () => {
    // 'a-moves' would also fail here, but the mutant nominates 'a-count', and a
    // contract that catches a defect by accident has not been shown to be sound.
    const misattributed: StateContract = {
      ...sound,
      assertions: [
        { id: 'a-count', path: 'weather.rain.particles', kind: 'exists' },
        { id: 'a-moves', path: 'weather.rain.headY', kind: 'changesOverTime' },
      ],
      mutants: [{ id: 'm-inert', kind: 'dropStateUpdate', mustBeCaughtBy: 'a-count' }],
    };
    expect(hardenContract(misattributed, before, after).hardened).toBe(false);
  });
});

describe('mutation kinds mirror WorldCoder-Bench failure modes', () => {
  it('dropStateUpdate rewinds the value to its pre-action state — present but inert', () => {
    const m = applyMutant(before, after, sound.mutants[0]!, 'weather.rain.headY') as typeof after;
    expect(m.weather.rain.headY).toBe(before.weather.rain.headY);
  });

  it('swapEventTarget renames the field — schema drift, 42.8% of real failures', () => {
    const m = applyMutant(before, after, sound.mutants[2]!, 'weather.rain.particles') as any;
    expect(m.weather.rain.particles).toBeUndefined();
    expect(m.weather.rain.particles_renamed).toBe(4000);
  });
});
