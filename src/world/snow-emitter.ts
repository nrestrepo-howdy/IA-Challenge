/**
 * WS5 · `snow-emitter` — slow drifting flakes with lateral noise.
 *
 * Catalogue slice `weather.snow`:
 *   particles   constant  the requested count
 *   driftPhase  animated  must move between snapshots
 *   instance    resource  present while mounted, gone after dispose()
 *
 * `driftPhase` accumulates without wrapping, so it is strictly increasing for any
 * positive step and any `drift` the schema admits (minimum 0.1). That makes the
 * `changesOverTime` assertion true by construction rather than true in practice — the
 * distinction that decides whether the primary oracle (D-1) can be trusted. The wrapped
 * angle and the lateral offset a renderer actually wants are published next to it.
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';
import { sampleWind } from './wind-field.js';

const TAU = Math.PI * 2;

/** Flakes fall slowly and at a fixed rate; `drift` parameterizes the wander, not the fall. */
const FALL_SPEED = 2.4;
/** How much a flake wanders sideways per unit of drift. */
const WANDER = 0.6;

export const SNOW_STATE_PATH = 'weather.snow';

export function createSnowEmitter(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'snow-emitter',
    {
      initial(ctx) {
        // A seeded phase offset so two snow fields never drift in lockstep, while each
        // one stays reproducible from its seed.
        const phase = ctx.rng() * TAU;
        return {
          particles: num(ctx.params, 'count'),
          driftPhase: phase,
          driftAngle: phase % TAU,
          lateral: Math.sin(phase) * num(ctx.params, 'drift') * WANDER,
          fallSpeed: FALL_SPEED,
          elapsed: 0,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const drift = num(ctx.params, 'drift');
        const wind = sampleWind(ctx.world);
        const phase = (state['driftPhase'] as number) + drift * dt;

        state['elapsed'] = (state['elapsed'] as number) + dt;
        state['driftPhase'] = phase;
        state['driftAngle'] = phase % TAU;
        // Wind biases where the wander happens; it does not accumulate, because a flake
        // that integrated wind forever would leave the volume it is drawn in.
        state['lateral'] =
          Math.sin(phase) * drift * WANDER + wind.direction[0] * wind.strength * WANDER;
      },
    },
    options,
  );
}

/** The catalogue-default instance. Fresh instances come from `createSnowEmitter()`. */
export const snowEmitter = createSnowEmitter();
