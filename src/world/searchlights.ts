/**
 * WS5 · `searchlights` — sweeping beams standing up out of the city.
 *
 * Catalogue slice `lighting.searchlights`:
 *   beams       constant  the requested number of lamps
 *   speed       constant  the requested sweep rate, in radians per second
 *   spread      constant  the requested beam half-angle, in degrees
 *   sweepPhase  animated  the sweep clock; must move between snapshots
 *   instance    resource  present while mounted, gone after dispose()
 *
 * The cheapest spectacular thing a night city can do. `ambient-light` and `daylight`
 * both answer "there is more light" by raising the level everywhere, which flattens a
 * scene built out of silhouettes; a beam is light that has a *direction* and an origin
 * inside the world, so it puts shape back rather than washing it out. It costs one
 * open cone per lamp — eight draw calls at the schema's maximum, against a scene that
 * already carries 260 instanced buildings (R-9).
 *
 * `sweepPhase` accumulates `speed * dt` and never wraps. The wrapped angles the
 * binding actually points the cones along are published beside it in `aim`, which is
 * the split every primitive here makes: the witness is the clock, and the value that
 * comes back around is derived from it. `changesOverTime` over a wrapping angle passes
 * or fails on where the window happened to fall, which makes the layer that decides
 * correctness (D-1) a coin flip — `lightning.ts` sets out the argument in full.
 *
 * Beams sweep at deliberately unequal rates. Lamps in lockstep read as one mechanism
 * seen several times; beams that drift apart and cross are what makes the sky look
 * searched.
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';

export const SEARCHLIGHT_STATE_PATH = 'lighting.searchlights';

/** Where the lamps stand: outside the camera orbit, inside the authored skyline. */
const LAMP_RADIUS = 205;

/** Seconds the beams take to come up to full brightness. */
const WARMUP_SECONDS = 1.6;

/** Beam tilt from vertical, in radians: the middle of the swing, and half its range. */
const TILT_MID = 0.62;
const TILT_SWING = 0.28;

export function createSearchlights(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'searchlights',
    {
      initial(ctx) {
        const beams = num(ctx.params, 'beams');
        return {
          beams,
          speed: num(ctx.params, 'speed'),
          spread: num(ctx.params, 'spread'),
          sweepPhase: 0,
          warmPhase: 0,
          // Dark on the frame the verb lands: lamps that are already at full power
          // read as a cut to a different world (AC-14).
          glow: 0,
          // Fixed at mount and published as plain data. The state layer stays
          // renderer-agnostic; the binding is the only thing that knows what a cone is.
          lamps: lamps(beams),
          aim: aimAt(0, beams),
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const beams = num(ctx.params, 'beams');
        const speed = num(ctx.params, 'speed');

        const sweep = (state['sweepPhase'] as number) + speed * dt;
        const warm = (state['warmPhase'] as number) + dt;
        state['sweepPhase'] = sweep;
        state['warmPhase'] = warm;
        state['glow'] = ease(clamp01(warm / WARMUP_SECONDS));
        state['aim'] = aimAt(sweep, beams);
      },
    },
    options,
  );
}

/** Lamp positions on the ground, `[x, z]` per beam. A ring, evenly spaced. */
function lamps(beams: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < beams; i++) {
    const a = (i / beams) * Math.PI * 2 + 0.4;
    out.push([Math.cos(a) * LAMP_RADIUS, Math.sin(a) * LAMP_RADIUS]);
  }
  return out;
}

/**
 * Where each beam points at this moment: `[azimuth, tilt]` per lamp, azimuth wrapped
 * into one turn so a binding never receives a number that grows without bound.
 */
function aimAt(sweep: number, beams: number): number[][] {
  const TAU = Math.PI * 2;
  const out: number[][] = [];
  for (let i = 0; i < beams; i++) {
    // Coprime-ish rates: the pattern takes a long time to repeat, which is the
    // difference between "searching" and "rotating".
    const rate = 1 + i * 0.17;
    const azimuth = (((sweep * rate + i * 2.399) % TAU) + TAU) % TAU;
    out.push([azimuth, TILT_MID + TILT_SWING * Math.sin(sweep * 0.63 + i * 1.7)]);
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep: a linear warm-up starts and stops with a visible step. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The catalogue-default instance. Fresh instances come from `createSearchlights()`. */
export const searchlights = createSearchlights();
