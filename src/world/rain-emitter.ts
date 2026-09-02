/**
 * WS5 · `rain-emitter` — falling precipitation with wind-coupled streaks.
 *
 * Catalogue slice `weather.rain`:
 *   particles  constant  the requested count
 *   fallSpeed  constant  the requested speed
 *   headY      animated  height of the lead droplet; must move between snapshots
 *   instance   resource  present while mounted, gone after dispose()
 *
 * `headY` is the interesting one. It is a wrapping value — a droplet reaching the floor
 * is recycled to the top, which is how every particle system works — and a wrapping
 * value is exactly the shape that can read identical in two snapshots while the system
 * is running perfectly. Two things prevent that from ever being reported as "present
 * but inert" (the failure R-1 is really measuring):
 *
 *   1. `MAX_STEP_SECONDS` in base.ts bounds one step, so a single frame can never
 *      traverse a whole cycle.
 *   2. Recycling draws a fresh spawn height from the seeded stream, so a droplet does
 *      not return to the height it left from. The jitter is physical — real rain does
 *      not enter the volume in lockstep — and it is seeded, so it is reproducible.
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';
import { sampleWind } from './wind-field.js';

/** Top of the rain volume. The catalogue's declared `headY` witness starts here. */
const CEILING = 300;
const FLOOR = 0;
/** Extra height a recycled droplet may spawn into, so the column does not pulse. */
const SPAWN_BAND = 40;

export const RAIN_STATE_PATH = 'weather.rain';

export function createRainEmitter(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'rain-emitter',
    {
      initial(ctx) {
        return {
          particles: num(ctx.params, 'count'),
          fallSpeed: num(ctx.params, 'speed'),
          spread: num(ctx.params, 'spread'),
          headY: CEILING,
          headX: 0,
          streak: 0,
          elapsed: 0,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const speed = num(ctx.params, 'speed');
        const spread = num(ctx.params, 'spread');
        const wind = sampleWind(ctx.world);
        const lateral = wind.direction[0] * wind.strength;

        state['elapsed'] = (state['elapsed'] as number) + dt;

        let y = (state['headY'] as number) - speed * dt;
        // `while` rather than `if`: correct even if a host ever hands us a step large
        // enough to cross more than one cycle, which is a cheaper guarantee than
        // trusting every caller to respect the clamp.
        while (y <= FLOOR) y += CEILING - FLOOR + ctx.rng() * SPAWN_BAND;
        state['headY'] = y;

        // The lateral column is bounded by the emitter footprint, so wind blows the
        // streaks sideways without letting a droplet escape the declared volume.
        const half = spread / 2;
        state['headX'] = wrapSymmetric((state['headX'] as number) + lateral * dt, half);
        state['streak'] = Math.hypot(speed, lateral) * dt;
      },
    },
    options,
  );
}

/** Wraps into [-half, half]. */
function wrapSymmetric(v: number, half: number): number {
  if (half <= 0) return 0;
  const span = half * 2;
  return ((((v + half) % span) + span) % span) - half;
}

/** The catalogue-default instance. Fresh instances come from `createRainEmitter()`. */
export const rainEmitter = createRainEmitter();
