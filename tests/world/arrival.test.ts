/**
 * The `mix` convention, held to rather than assumed.
 *
 * Four primitives take time to become themselves — a cross-fade, a brightening, a tide
 * rising — and each publishes its progress as a 0..1 ramp named `mix`. Nothing enforced
 * that: it was four files agreeing by habit. `settle()` in the cycle now reads it to
 * decide when the world has finished arriving and L3 may judge the picture, so the
 * habit has become an interface, and an interface with no test is a coincidence waiting
 * to be broken.
 *
 * What this pins is the part a reader would get wrong: that `mix` starts below one and
 * reaches it. A primitive publishing a ramp that never completed would stall every
 * visual judgement in the app up to the cap, silently, and look like slowness.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { readPath } from '../../src/harness/l2-contract.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import { createAurora } from '../../src/world/aurora.js';
import { createDaylight } from '../../src/world/daylight.js';
import { createGroundTint } from '../../src/world/ground-tint.js';
import { createWater } from '../../src/world/water.js';

const RAMPS = [
  ['aurora', createAurora],
  ['daylight', createDaylight],
  ['ground-tint', createGroundTint],
  ['water', createWater],
] as const;

describe('primitives that take time to arrive', () => {
  for (const [name, create] of RAMPS) {
    it(`${name} publishes a mix that starts below 1 and reaches it (AC-14)`, () => {
      const spec = findPrimitive(CATALOGUE, name)!;
      const world = new World();
      create({ seed: 3 }).mount(world, { ...spec.defaults });
      const mix = () => readPath(world.state, `${spec.statePath}.mix`) as number;

      expect(mix()).toBeLessThan(1);
      // Ten seconds of frames: longer than any ramp in the catalogue, so a ramp
      // unfinished here is one that never finishes.
      for (let i = 0; i < 600; i++) world.tick(1 / 60);
      expect(mix()).toBeGreaterThanOrEqual(0.98);
    });
  }
});
