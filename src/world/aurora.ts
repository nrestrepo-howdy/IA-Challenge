/**
 * WS5 · `aurora` — ribbons of light across the upper sky.
 *
 * Catalogue slice `atmosphere.aurora`:
 *   intensity     constant  the requested brightness
 *   bands         constant  the requested number of curtains
 *   hue           constant  the requested colour, as a hue in [0, 1]
 *   curtainPhase  animated  the drift clock; must move between snapshots
 *   instance      resource  present while mounted, gone after dispose()
 *
 * The world is authored at night and, until this entry existed, nothing in the
 * catalogue answered "make it beautiful". Weather can only ever subtract from a night
 * sky — rain greys it, fog hides it — so the one thing a user could not ask for was
 * the sky doing something spectacular on its own.
 *
 * Two published values do the drawing, and neither of them is the animated witness:
 *
 *   - `glow` is what the binding spends on brightness. It is `intensity` times the
 *     fade-in times `visibility`, so it eases in from nothing and then, correctly,
 *     stops moving once the curtains are up. `changesOverTime` over it would be a
 *     stopwatch rather than an oracle — the argument is spelled out in `lightning.ts`.
 *   - `curtainPhase` is the monotonic drift clock the ribbons are a function of. It
 *     advances at a fixed rate rather than one scaled by `intensity`, because the
 *     schema admits a very faint aurora and an `animated` field that stalls for a legal
 *     parameter is a contract that fails on a primitive which is behaving.
 *
 * **Daylight coupling.** An aurora at noon is not a dimmer aurora, it is a mistake, so
 * `visibility` is read from whatever time of day the world currently publishes —
 * `sampleWind()` is the same move, and for the same reason: a primitive reads across
 * slices and writes only inside its own (AC-05). A world with no `daylight` mounted is
 * the authored midnight, which is why an absent slice means full visibility rather than
 * an error.
 */
import type { WorldHandle } from '../contracts.js';
import { definePrimitive, num, readState, type PrimitiveOptions } from './base.js';
import { DAYLIGHT_STATE_PATH } from './daylight.js';

export const AURORA_STATE_PATH = 'atmosphere.aurora';

/** Turns per second of the curtain drift. Slow: an aurora that hurries reads as smoke. */
const DRIFT_HZ = 0.045;

/** Seconds the curtains take to arrive. They brighten in; they do not switch on. */
const FADE_SECONDS = 3.5;

/**
 * How fast daylight puts the aurora out.
 *
 * `brightness` is 0 at midnight and 1 at noon, so 1.8 means the ribbons are gone a
 * little after the sun clears the horizon — which is when a real aurora stops being
 * visible, and well before the sky finishes turning blue.
 */
const DAY_EXTINCTION = 1.8;

export function createAurora(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'aurora',
    {
      initial(ctx) {
        const visibility = visibleFraction(ctx.world);
        return {
          intensity: num(ctx.params, 'intensity'),
          bands: num(ctx.params, 'bands'),
          hue: num(ctx.params, 'hue'),
          curtainPhase: 0,
          fadePhase: 0,
          mix: 0,
          visibility,
          // Zero at frame zero whatever the parameters say: the sky the verb lands on
          // is the sky the user is already looking at (AC-14).
          glow: 0,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const intensity = num(ctx.params, 'intensity');

        state['curtainPhase'] = (state['curtainPhase'] as number) + DRIFT_HZ * dt;

        const fade = (state['fadePhase'] as number) + dt;
        const mix = ease(clamp01(fade / FADE_SECONDS));
        const visibility = visibleFraction(ctx.world);

        state['fadePhase'] = fade;
        state['mix'] = mix;
        state['visibility'] = visibility;
        state['glow'] = intensity * mix * visibility;
      },
    },
    options,
  );
}

/**
 * How much of the aurora the sky currently admits, 0..1.
 *
 * Absent `daylight` is the authored midnight rather than an error, the same way an
 * absent wind field is dead calm: a world with an aurora and no time-of-day verb is a
 * legal world, and it is in fact the common one.
 */
function visibleFraction(world: WorldHandle): number {
  const brightness = readState(world, `${DAYLIGHT_STATE_PATH}.brightness`);
  if (typeof brightness !== 'number' || !Number.isFinite(brightness)) return 1;
  return clamp01(1 - brightness * DAY_EXTINCTION);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep: a linear fade starts and stops with a step the eye reads at both ends. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The catalogue-default instance. Fresh instances come from `createAurora()`. */
export const aurora = createAurora();
