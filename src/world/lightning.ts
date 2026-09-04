/**
 * WS5 · `lightning` — an occasional bright flash with a decaying afterglow.
 *
 * Catalogue slice `weather.lightning`:
 *   peak      constant  the requested flash intensity
 *   decay     constant  the requested afterglow decay rate
 *   phase     animated  the storm clock; must move between snapshots
 *   instance  resource  present while mounted, gone after dispose()
 *
 * The flash is episodic, and that is exactly what makes the choice of animated field
 * load-bearing. `glow` is the visible quantity, but between two strikes it decays
 * towards zero and — over a short window, at a low frequency — can read close enough
 * to identical at both ends that a `changesOverTime` assertion becomes a coin flip.
 * The primary oracle (D-1) may not be a coin flip: a flaky assertion there is
 * indistinguishable from a real defect. So the catalogue tags `phase` instead — the
 * strictly-increasing clock the strikes are scheduled against, which advances by
 * `frequency * dt` for every step and every frequency the schema admits (minimum
 * 0.02). Animation is then true by construction rather than true on average.
 *
 * Strike times come from the seeded stream (`prng.ts`), never `Math.random()`: a
 * verdict that cannot be replayed from the seed is a verdict a nightly failure cannot
 * be reproduced from.
 */
import { definePrimitive, num, type MountContext, type PrimitiveOptions } from './base.js';

export const LIGHTNING_STATE_PATH = 'weather.lightning';

/**
 * Jitter around the mean interval, as a fraction of it. Strikes at a fixed period
 * would read as a metronome rather than as weather, and the offset is seeded, so the
 * irregularity costs nothing in reproducibility.
 */
const JITTER = 0.5;

export function createLightning(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'lightning',
    {
      initial(ctx) {
        return {
          peak: num(ctx.params, 'intensity'),
          decay: num(ctx.params, 'decay'),
          frequency: num(ctx.params, 'frequency'),
          phase: 0,
          // Mounting mid-storm rather than at a flash: the world does not owe the user
          // a strike on the frame the verb lands.
          glow: 0,
          flashes: 0,
          sinceFlash: 0,
          nextIn: nextInterval(ctx),
          elapsed: 0,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const peak = num(ctx.params, 'intensity');
        const decay = num(ctx.params, 'decay');
        const frequency = num(ctx.params, 'frequency');

        state['elapsed'] = (state['elapsed'] as number) + dt;
        state['phase'] = (state['phase'] as number) + frequency * dt;

        // Exponential rather than linear: an afterglow that reaches zero and stops is
        // a step function, and the eye reads the tail, not the peak.
        state['glow'] = (state['glow'] as number) * Math.exp(-decay * dt);

        const since = (state['sinceFlash'] as number) + dt;
        if (since >= (state['nextIn'] as number)) {
          state['glow'] = peak;
          state['flashes'] = (state['flashes'] as number) + 1;
          state['sinceFlash'] = 0;
          state['nextIn'] = nextInterval(ctx);
        } else {
          state['sinceFlash'] = since;
        }
      },
    },
    options,
  );
}

/** Seconds until the next strike: the mean period, jittered from the seeded stream. */
function nextInterval(ctx: MountContext): number {
  const frequency = num(ctx.params, 'frequency');
  return ((1 - JITTER) + ctx.rng() * JITTER * 2) / frequency;
}

/** The catalogue-default instance. Fresh instances come from `createLightning()`. */
export const lightning = createLightning();
