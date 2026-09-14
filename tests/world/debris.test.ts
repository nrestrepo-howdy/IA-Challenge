/**
 * Falling bodies, and the one assertion in this project that is a law rather than a
 * preference.
 *
 * Every other primitive is judged against what someone decided it should do: rain falls
 * at the speed the catalogue says, a dawn takes the seconds it was given. Those are
 * conventions, and a contract over them checks that the code did what it was told.
 *
 * This one can be checked against physics. A semi-implicit integrator with restitution
 * below one is dissipative, so **total mechanical energy falls monotonically** — and a
 * world that gains energy every bounce does not look broken, it looks *livelier*, right
 * up until the bodies leave the frame. That is the failure class WorldCoder-Bench reports
 * as dominant: hidden state drifting out of agreement with a scene that still looks
 * plausible, and it is precisely what a visual check cannot see.
 *
 * The integrator bug this catches is the common one. Explicit Euler — reading velocity
 * before the acceleration is applied rather than after — injects energy on every step.
 * It renders beautifully.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import { createDebris } from '../../src/world/debris.js';

const spec = findPrimitive(CATALOGUE, 'debris')!;

function drop(overrides: Record<string, unknown> = {}): World {
  const world = new World();
  createDebris({ seed: 5 }).mount(world, { ...spec.defaults, ...overrides } as never);
  return world;
}

const read = (world: World): Record<string, never> =>
  (world.state as Record<string, Record<string, Record<string, never>>>)['physics']!['debris']!;

describe('debris · the law (AC-06)', () => {
  it('never gains energy, over fifteen seconds of falling and bouncing', () => {
    const world = drop();
    let previous = read(world)['energy'] as unknown as number;
    let gained = 0;
    let largest = 0;

    for (let frame = 0; frame < 900; frame++) {
      world.tick(1 / 60);
      const energy = read(world)['energy'] as unknown as number;
      // A tolerance, not zero: these are floats, and a bound of exactly zero would be
      // asserting against the arithmetic rather than against the physics.
      if (energy > previous + 1e-6) { gained += 1; largest = Math.max(largest, energy - previous); }
      previous = energy;
    }

    expect(gained, `energy rose on ${gained} frames, worst by ${largest}`).toBe(0);
  });

  it('loses most of it, which is the difference between dissipating and drifting', () => {
    // The mirror. A body frozen at its starting height also never gains energy, and
    // would pass the assertion above while doing nothing at all.
    const world = drop();
    const start = read(world)['energy'] as unknown as number;
    for (let frame = 0; frame < 900; frame++) world.tick(1 / 60);
    expect(read(world)['energy'] as unknown as number).toBeLessThan(start * 0.1);
  });

  it('comes to rest rather than shivering on the floor', () => {
    const world = drop();
    for (let frame = 0; frame < 900; frame++) world.tick(1 / 60);
    expect(read(world)['atRest']).toBe(read(world)['count']);
  });

  it('keeps every body above the ground it landed on', () => {
    const world = drop({ bounce: 0.85 });
    for (let frame = 0; frame < 600; frame++) {
      world.tick(1 / 60);
      const bodies = read(world)['bodies'] as unknown as number[];
      for (let i = 1; i < bodies.length; i += 3) expect(bodies[i]).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('survives a frame that took a second, which is a tab coming back', () => {
    // Unclamped, one enormous step integrates a body straight through the floor and the
    // world never recovers. The clamp is in `step`; this is what makes it a rule.
    const world = drop();
    world.tick(1);
    const bodies = read(world)['bodies'] as unknown as number[];
    for (let i = 1; i < bodies.length; i += 3) expect(bodies[i]).toBeGreaterThanOrEqual(-1e-9);
  });

  it('is deterministic: the same seed lands the same pile', () => {
    const a = drop(); const b = drop();
    for (let f = 0; f < 300; f++) { a.tick(1 / 60); b.tick(1 / 60); }
    expect(read(a)['bodies']).toEqual(read(b)['bodies']);
  });
});
