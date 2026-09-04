/**
 * WS5 · `tower` — raises a distinctive structure out of the ground.
 *
 * Catalogue slice `structures.tower`:
 *   height     constant  the requested height
 *   girth      constant  the requested footprint
 *   towers     constant  the requested count
 *   placement  constant  the requested layout
 *   risePhase  animated  the rise clock; must move between snapshots
 *   instance   resource  present while mounted, gone after dispose()
 *
 * The first structural verb, and the first one where "changed the world" and "changed
 * the weather" part company. What it owes its contract is the same thing every other
 * primitive owes: the numbers it publishes are the numbers that were asked for, and
 * something genuinely moves.
 *
 * The animated field is the same choice `lightning` had to make, arrived at from the
 * opposite direction. There the visible quantity was episodic; here it *saturates* —
 * `growth` eases to 1 and then, correctly, never changes again. A `changesOverTime`
 * assertion over it would pass while the tower is rising and fail forever afterwards,
 * which turns the primary oracle (D-1) into a stopwatch. `risePhase` is the monotonic
 * seconds clock `growth` is computed from, so it advances on every step regardless of
 * when the window falls.
 *
 * A tower that pops into existence also reads as a glitch rather than as construction,
 * so the rise is real: `grown` carries the current height of each site and the binding
 * draws from it. The layout is a pure function of the parameters and the site index —
 * no `Math.random()`, and deliberately not the seeded stream either, because `layout()`
 * is recomputed every step and drawing from a stream there would advance it once per
 * frame and walk the footprint out from under the tower.
 */
import { definePrimitive, num, str, type MountContext, type PrimitiveOptions } from './base.js';

export const TOWER_STATE_PATH = 'structures.tower';

/** Seconds a single tower takes to reach full height. */
const RISE_SECONDS = 2.4;

/** Seconds between one tower starting to rise and the next. */
const STAGGER_SECONDS = 0.45;

/** Where a `ring` layout sits: outside the camera orbit, inside the authored skyline. */
const RING_RADIUS = 210;

/** One tower's authored footprint. Fixed at mount; only its height animates. */
interface Site {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly spin: number;
  /** Seconds before this one starts rising, so a group builds rather than blinks. */
  readonly delay: number;
}

export function createTower(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'tower',
    {
      initial(ctx) {
        const sites = layout(ctx);
        return {
          height: num(ctx.params, 'height'),
          girth: num(ctx.params, 'girth'),
          towers: num(ctx.params, 'count'),
          placement: str(ctx.params, 'placement'),
          risePhase: 0,
          growth: 0,
          // Published as plain data, never as geometry: the state layer stays
          // renderer-agnostic, and the binding is the only thing that knows what a
          // box is.
          sites: sites.map((s) => [s.x, s.z, s.width, s.depth, s.height, s.spin]),
          grown: sites.map(() => 0),
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const sites = layout(ctx);
        const phase = (state['risePhase'] as number) + dt;
        state['risePhase'] = phase;
        // The overall figure the eye reads: the last tower to finish decides it.
        state['growth'] = ease(clamp01((phase - STAGGER_SECONDS * (sites.length - 1)) / RISE_SECONDS));
        state['grown'] = sites.map((s) => s.height * ease(clamp01((phase - s.delay) / RISE_SECONDS)));
      },
    },
    options,
  );
}

/**
 * Deterministic from the parameters and the site index alone.
 *
 * Recomputed each step rather than captured, which is what `orbit-modulator` does with
 * its own geometry: the parameters are the authority, and a cached layout is a second
 * copy of them that can disagree.
 */
function layout(ctx: MountContext): readonly Site[] {
  const height = num(ctx.params, 'height');
  const girth = num(ctx.params, 'girth');
  const count = num(ctx.params, 'count');
  const placement = str(ctx.params, 'placement');

  const sites: Site[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = wobble(i + 1);
    const [x, z] = site(placement, i, count, jitter);
    // The tallest first, so a group reads as a skyline rather than as a fence.
    const taper = 1 - (i / Math.max(1, count)) * 0.45;
    sites.push({
      x,
      z,
      width: girth * (0.85 + jitter * 0.3),
      depth: girth * (0.85 + wobble(i * 7 + 3) * 0.3),
      height: height * taper,
      spin: jitter * Math.PI,
      delay: i * STAGGER_SECONDS,
    });
  }
  return sites;
}

function site(placement: string, i: number, count: number, jitter: number): [number, number] {
  switch (placement) {
    case 'ring': {
      const a = (i / count) * Math.PI * 2;
      return [Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS];
    }
    case 'avenue': {
      // A row set back from the camera orbit, so it crosses frame rather than
      // standing between the camera and everything else.
      return [(i - (count - 1) / 2) * 70, -180 - jitter * 30];
    }
    default: {
      // `center`: the first one dead on the origin — the camera looks at (0, 62, 0),
      // so this is the one placement guaranteed to be in frame.
      if (i === 0) return [0, 0];
      const a = i * 2.399;
      const r = 55 + i * 26;
      return [Math.cos(a) * r, Math.sin(a) * r];
    }
  }
}

/** A stable pseudo-random in [0, 1) from an integer. Same index, same value, forever. */
function wobble(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep: a linear rise starts and stops with a visible jerk at both ends. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The catalogue-default instance. Fresh instances come from `createTower()`. */
export const tower = createTower();
