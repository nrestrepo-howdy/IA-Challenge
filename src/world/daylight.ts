/**
 * WS5 · `daylight` — the time of day.
 *
 * Catalogue slice `atmosphere.daylight`:
 *   phase       constant  the requested time, 0 = midnight, 0.5 = noon
 *   transition  constant  the requested cross-fade duration, in seconds
 *   dayClock    animated  the sweep clock; must move between snapshots
 *   instance    resource  present while mounted, gone after dispose()
 *
 * The world is authored at night, so "make it day" is the first thing a person types
 * and, until this entry existed, the catalogue had no way to say it: `ambient-light`
 * brightens a night scene, which is not the same request. Time of day is one number
 * that everything else in the sky is a function of — gradient, disc, stars, key light,
 * fog — so it is one primitive publishing one scalar rather than five verbs a user
 * would have to compose by hand.
 *
 * Three published values do the work, and the split between them is deliberate:
 *
 *   - `phase` is the *requested* time and never moves. `constant` means exactly that,
 *     and it is what proves the code used the number it was asked for.
 *   - `phaseNow` sweeps from the authored midnight towards `phase` and is what the
 *     binding draws. It goes forward around the clock rather than taking the shorter
 *     arc, so "make it day" rises through dawn instead of dissolving into noon: a sky
 *     that cuts is a sky that reads as a page swap rather than as a world changing.
 *   - `dayClock` is the animated witness. `phaseNow` and `mix` both arrive and stop —
 *     asserting `changesOverTime` over a saturating value is a stopwatch, not an
 *     oracle, and would make the primary oracle (D-1) pass or fail on when the
 *     window happened to fall (the argument is spelled out in `lightning.ts`).
 *
 * No renderer is imported here. The primitive publishes a time; deciding what colour
 * that time is belongs to `daylightBinding`, which is the only place that knows a sky
 * mesh exists.
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';

export const DAYLIGHT_STATE_PATH = 'atmosphere.daylight';

/**
 * The phase the base scene was authored at. The sweep starts here rather than at the
 * requested value so frame zero of the verb is the world the user is already looking
 * at, and the binding's cross-fade has somewhere honest to come from (AC-14).
 */
export const AUTHORED_PHASE = 0;

export function createDaylight(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'daylight',
    {
      initial(ctx) {
        return {
          phase: num(ctx.params, 'phase'),
          transition: num(ctx.params, 'transition'),
          dayClock: 0,
          mix: 0,
          phaseNow: AUTHORED_PHASE,
          // Published from frame zero so a binding never has to invent a first value:
          // sin(2π(p - ¼)) is -1 at midnight, 0 at dawn, +1 at noon, 0 at dusk.
          sunElevation: Math.sin(2 * Math.PI * (AUTHORED_PHASE - 0.25)),
          brightness: 0,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const target = num(ctx.params, 'phase');
        const transition = num(ctx.params, 'transition');

        const clock = (state['dayClock'] as number) + dt;
        state['dayClock'] = clock;

        const mix = ease(clamp01(clock / transition));
        // Forward around the clock, never the shorter arc: the sweep is the picture.
        const forward = mod1(target - AUTHORED_PHASE);
        const phaseNow = mod1(AUTHORED_PHASE + forward * mix);
        const elevation = Math.sin(2 * Math.PI * (phaseNow - 0.25));

        state['mix'] = mix;
        state['phaseNow'] = phaseNow;
        state['sunElevation'] = elevation;
        state['brightness'] = (elevation + 1) / 2;
      },
    },
    options,
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mod1(v: number): number {
  return ((v % 1) + 1) % 1;
}

/** Smoothstep: a linear sweep starts and stops with a jerk, and the eye reads the ends. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The catalogue-default instance. Fresh instances come from `createDaylight()`. */
export const daylight = createDaylight();
