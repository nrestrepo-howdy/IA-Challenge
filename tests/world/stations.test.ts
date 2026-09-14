/**
 * Two rigs may not stand in the same place.
 *
 * This was the visible fault: every figure in the catalogue was authored with the same
 * origin, so asking for a person and then for a car put both of them on the same three
 * square metres, pacing the same short line through each other. Nothing in state was
 * wrong — which is exactly why it needs a test rather than an oracle.
 *
 * The property is stronger than "their origins differ". A rig is not a point: it paces.
 * What has to hold is that the *ground each one covers* is disjoint, so the assertion
 * measures how far each rig actually strays from its station over a full cycle of its
 * own animation and requires the stations to be further apart than the sum of those two
 * reaches. A rig that grows a longer stride, or a spiral that is packed tighter, fails
 * here rather than on screen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FIGURES } from '../../src/intent/figures.js';
import type { PoseTarget } from '../../src/world/figure.js';
import { resetStations, stationFor } from '../../src/world/stations.js';

/** How far, in authored units, any part of this rig gets from its own origin. */
function reachOf(pose: string, parts: number): number {
  const run = new Function('t', 'p', pose) as (t: number, p: PoseTarget[]) => void;
  let far = 0;
  // A full lap of the longest cycle in the catalogue. The walk takes 150/4.6 ≈ 33
  // seconds to pace out and back, and sampling less than that measures half a stride.
  for (let t = 0; t < 40; t += 0.25) {
    const targets: PoseTarget[] = Array.from({ length: parts }, () => ({
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 1,
    }));
    run(t, targets);
    for (const target of targets) far = Math.max(far, Math.hypot(target.x, target.z));
  }
  return far;
}

describe('a rig gets ground of its own', () => {
  beforeEach(resetStations);

  it('claims the same station for the same name, every time', () => {
    // `figures.<name>` is one state path, so the same name is the same rig being
    // replaced. Re-running an utterance must put it back, not move it.
    const first = stationFor('dog-walker');
    expect(stationFor('dog-walker')).toEqual(first);
    expect(stationFor('car')).not.toEqual(first);
  });

  it('never places two of the catalogue within reach of each other', () => {
    const placed = FIGURES.map((figure) => ({
      name: figure.name,
      station: stationFor(figure.name),
      reach: reachOf(figure.pose, figure.parts.length),
    }));

    for (const a of placed) {
      for (const b of placed) {
        if (a.name >= b.name) continue;
        const gap = Math.hypot(
          a.station.origin[0] - b.station.origin[0],
          a.station.origin[2] - b.station.origin[2],
        );
        expect(
          gap,
          `"${a.name}" (reach ${a.reach.toFixed(0)}) and "${b.name}" (reach ${b.reach.toFixed(0)}) overlap`,
        ).toBeGreaterThan(a.reach + b.reach);
      }
    }
  });
});
