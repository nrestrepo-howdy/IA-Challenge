/**
 * A rig must be one body, at every moment of its own animation.
 *
 * This is the invariant that was missing, and its absence is written across the log: a
 * forearm that swung away from its elbow through part of the stride, a dog whose legs
 * were being written into the person's, limbs placed outside the torso and limbs buried
 * inside it. Every one was found by taking a screenshot and looking at it — which works,
 * and does not scale, and only ever catches the frame that happened to be captured.
 *
 * "Does it look like a dog" is taste and belongs to L3. "Is it a single connected body"
 * is not taste: it is geometry, it is decidable, and a rig that fails it is broken
 * whatever it is meant to depict. So it is checked here, deterministically, over a full
 * cycle rather than at one instant — the gaps that mattered opened and closed through the
 * stride and are invisible at rest.
 *
 * Parts are modelled as capsules, because that is what most of them are: a segment along
 * the part's own axis with a radius around it. Shapes with no axis collapse to a sphere
 * at their centre, with the bounding radius rather than a tight one — conservative on
 * purpose. A conservative radius can only ever report two parts as *touching* when they
 * are not, so this test under-reports disconnection and never invents it.
 */
import { describe, expect, it } from 'vitest';
import { FIGURES } from '../../src/intent/figures.js';
import type { PoseTarget } from '../../src/world/figure.js';

interface Segment {
  readonly ax: number; readonly ay: number; readonly az: number;
  readonly bx: number; readonly by: number; readonly bz: number;
  readonly r: number;
}

/** Shapes whose geometry runs along their local +Y. Everything else is a blob. */
const AXIAL = new Set(['capsule', 'cylinder', 'cone']);

/**
 * The part's own +Y axis after a YXZ rotation — the order the renderer applies.
 *
 * R = Ry(yaw) · Rx(pitch) · Rz(roll), so (0,1,0) maps to the vector below. Getting this
 * wrong would tilt every segment consistently and the test would still pass, which is
 * why it is written out rather than approximated by the bounding radius.
 */
function axisOf(t: PoseTarget): [number, number, number] {
  const sy = Math.sin(t.yaw), cy = Math.cos(t.yaw);
  const sp = Math.sin(t.pitch), cp = Math.cos(t.pitch);
  const sr = Math.sin(t.roll), cr = Math.cos(t.roll);
  // Rz · (0,1,0) = (-sin r, cos r, 0); then Rx; then Ry.
  const x1 = -sr, y1 = cr * cp, z1 = cr * sp;
  return [x1 * cy + z1 * sy, y1, -x1 * sy + z1 * cy];
}

function segmentFor(shape: string, size: readonly number[], t: PoseTarget): Segment {
  const sx = Math.abs(size[0] ?? 0), sy = Math.abs(size[1] ?? 0), sz = Math.abs(size[2] ?? 0);
  const scale = t.scale > 0 ? t.scale : 1;
  if (!AXIAL.has(shape)) {
    const r = Math.hypot(sx, sy, sz) * scale;
    return { ax: t.x, ay: t.y, az: t.z, bx: t.x, by: t.y, bz: t.z, r };
  }
  const [ux, uy, uz] = axisOf(t);
  const h = sy * scale;
  const r = Math.max(sx, sz) * scale;
  return {
    ax: t.x - ux * h, ay: t.y - uy * h, az: t.z - uz * h,
    bx: t.x + ux * h, by: t.y + uy * h, bz: t.z + uz * h,
    r,
  };
}

/**
 * Closest distance between two line segments, clamped to their ends.
 *
 * The degenerate cases are the whole difficulty, and getting one wrong is silent: the
 * first version handled "q is a point" and not "p is a point", so a sphere sitting
 * exactly on a cylinder's axis measured 80 units from it instead of 0, and the test
 * reported a tree's canopy as having fallen off its trunk. A geometry helper that is
 * wrong in one branch produces confident, specific, false failures.
 */
function segmentDistance(p: Segment, q: Segment): number {
  const EPS = 1e-9;
  const ux = p.bx - p.ax, uy = p.by - p.ay, uz = p.bz - p.az;
  const vx = q.bx - q.ax, vy = q.by - q.ay, vz = q.bz - q.az;
  const wx = p.ax - q.ax, wy = p.ay - q.ay, wz = p.az - q.az;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));

  let s: number;
  let t: number;
  if (a <= EPS && c <= EPS) {
    s = 0; t = 0;                                  // two points
  } else if (a <= EPS) {
    s = 0; t = clamp(e / c);                       // p is a point, project onto q
  } else if (c <= EPS) {
    t = 0; s = clamp(-d / a);                      // q is a point, project onto p
  } else {
    const den = a * c - b * b;
    s = den > EPS ? clamp((b * e - c * d) / den) : 0;
    t = (b * s + e) / c;
    if (t < 0) { t = 0; s = clamp(-d / a); }
    else if (t > 1) { t = 1; s = clamp((b - d) / a); }
  }

  const dx = wx + s * ux - t * vx;
  const dy = wy + s * uy - t * vy;
  const dz = wz + s * uz - t * vz;
  return Math.hypot(dx, dy, dz);
}

/** Part indices reachable from part 0, following overlaps. */
function reachable(segments: readonly Segment[], slack: number): Set<number> {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const i = queue.pop()!;
    for (let j = 0; j < segments.length; j++) {
      if (seen.has(j)) continue;
      const a = segments[i]!, b = segments[j]!;
      if (segmentDistance(a, b) - (a.r + b.r) <= slack) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen;
}

function poseAt(figure: (typeof FIGURES)[number], t: number): PoseTarget[] {
  const run = new Function('t', 'p', figure.pose) as (t: number, p: PoseTarget[]) => void;
  const targets: PoseTarget[] = figure.parts.map(() => ({
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 1,
  }));
  run(t, targets);
  return targets;
}

describe('a rig is one connected body throughout its animation', () => {
  // The walk paces a full oval in about 33 s; sampling less than that measures half a
  // stride, and half a stride is where the old gaps were closed.
  const SAMPLES = Array.from({ length: 140 }, (_, i) => i * 0.25);
  // Authored units. At FIGURE_SCALE this is about a centimetre — enough for floating
  // point and for parts that sit exactly flush, and nowhere near a visible gap.
  const SLACK = 0.25;

  for (const figure of FIGURES) {
    it(`"${figure.name}" never comes apart`, () => {
      let worstAt = -1;
      let adrift: string[] = [];

      for (const t of SAMPLES) {
        const targets = poseAt(figure, t);
        const segments = figure.parts.map((part, i) =>
          segmentFor(part.shape, part.size, targets[i]!));
        const seen = reachable(segments, SLACK);
        if (seen.size === figure.parts.length) continue;
        // Keep the worst sample, so the message names the moment it is most broken
        // rather than the first moment it is broken at all.
        if (worstAt < 0 || figure.parts.length - seen.size > adrift.length) {
          worstAt = t;
          adrift = figure.parts.filter((_, i) => !seen.has(i)).map((p) => p.id);
        }
      }

      expect(
        adrift,
        worstAt < 0 ? '' : `at t=${worstAt.toFixed(2)}s these parts are not reachable from the rig`,
      ).toEqual([]);
    });
  }
});
