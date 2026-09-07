/**
 * WS5 · `water` — a reflective surface at a settable level.
 *
 * Catalogue slice `surface.water`:
 *   level       constant  the requested waterline, in world units
 *   choppiness  constant  the requested surface agitation
 *   wavePhase   animated  the swell clock; must move between snapshots
 *   instance    resource  present while mounted, gone after dispose()
 *
 * The other thing a first-time user reaches for, and the catalogue had nothing for it:
 * `ground-tint` can make the ground blue, which is a blue floor, not water. What makes
 * a surface read as water is that it *moves* and that it *answers the light* — so the
 * primitive publishes a waterline and a swell clock, and the binding spends them on a
 * displaced, near-mirror plane rather than on a render target. A real reflection pass
 * would double the scene's draw calls for a surface the camera only ever sees at a
 * grazing angle (R-9), and at night a specular response to the moon is what the eye is
 * reading anyway.
 *
 * `wavePhase` advances by `choppiness * dt`, and the schema's minimum choppiness is
 * 0.05, so it moves on every step for every parameter the catalogue admits. It is the
 * animated witness rather than `levelNow`, which eases into place and then correctly
 * stops: `changesOverTime` over a saturating value is a stopwatch, not an oracle
 * (`lightning.ts` sets out why the primary oracle may not be a coin flip).
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';

export const WATER_STATE_PATH = 'surface.water';

/** Seconds for the water to reach its level. */
const FLOOD_SECONDS = 2.5;

/** How far below its level the water starts, so it rises in rather than appearing. */
const FLOOD_DEPTH = 26;

export function createWater(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'water',
    {
      initial(ctx) {
        const level = num(ctx.params, 'level');
        return {
          level,
          choppiness: num(ctx.params, 'choppiness'),
          wavePhase: 0,
          // The flood's own clock, kept separate from `wavePhase`. Deriving the rise
          // from the swell would make choppy water flood faster than calm water — a
          // parameter quietly doing a second job is how two individually correct
          // values end up disagreeing.
          floodPhase: 0,
          mix: 0,
          // Below its waterline at frame zero: water that is simply *there* on the
          // frame the verb lands reads as a jump cut, which is the same argument
          // `tower.ts` makes for growing rather than appearing.
          levelNow: level - FLOOD_DEPTH,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const level = num(ctx.params, 'level');
        const choppiness = num(ctx.params, 'choppiness');

        state['wavePhase'] = (state['wavePhase'] as number) + choppiness * dt;

        const flood = (state['floodPhase'] as number) + dt;
        const mix = ease(clamp01(flood / FLOOD_SECONDS));
        state['floodPhase'] = flood;
        state['mix'] = mix;
        state['levelNow'] = level - FLOOD_DEPTH * (1 - mix);
      },
    },
    options,
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep: water that rises at a constant rate starts and stops with a jerk. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The catalogue-default instance. Fresh instances come from `createWater()`. */
export const water = createWater();
