/**
 * WS5 · `wind-field` — a directional force field other primitives sample.
 *
 * Catalogue slice `forces.wind`:
 *   direction  vector    inside [-1, 1]^3
 *   strength   constant  the parameter, unmodified
 *   gustPhase  animated  must move between snapshots
 *   instance   resource  present while mounted, gone after dispose()
 *
 * Two details are load-bearing for the contract this primitive has to satisfy:
 *
 *   - `strength` publishes the requested value and nothing else. The gust envelope
 *     lives in a separate `gust` field, because the `constant` role exists precisely to
 *     prove the code used the value the utterance asked for; folding a time-varying
 *     multiplier into it would break that proof for a primitive that is behaving.
 *
 *   - `gustPhase` accumulates monotonically instead of wrapping at 2*pi, and it
 *     advances at a fixed rate rather than one scaled by `strength`. The schema admits
 *     `strength: 0` (dead calm), and a phase scaled by strength would then sit still —
 *     an `animated` field that is provably inert for a legal parameter. The wrapped
 *     angle a renderer wants is published alongside it as `gustAngle`.
 */
import type { WorldHandle } from '../contracts.js';
import { definePrimitive, num, readState, vec3, type PrimitiveOptions } from './base.js';

const TAU = Math.PI * 2;

/** Gust period, in Hz. Slow enough to read as weather rather than as a flicker. */
const GUST_HZ = 0.4;
/** Fraction of `strength` the gust envelope swings by. */
const GUST_DEPTH = 0.35;

export const WIND_STATE_PATH = 'forces.wind';

export function createWindField(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'wind-field',
    {
      initial(ctx) {
        return {
          direction: normalize(vec3(ctx.params, 'direction')),
          strength: num(ctx.params, 'strength'),
          gustPhase: 0,
          gustAngle: 0,
          gust: num(ctx.params, 'strength'),
          elapsed: 0,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const strength = num(ctx.params, 'strength');
        const phase = (state['gustPhase'] as number) + TAU * GUST_HZ * dt;
        state['elapsed'] = (state['elapsed'] as number) + dt;
        state['gustPhase'] = phase;
        state['gustAngle'] = phase % TAU;
        state['gust'] = strength * (1 + GUST_DEPTH * Math.sin(phase));
      },
    },
    options,
  );
}

export interface WindSample {
  readonly direction: readonly [number, number, number];
  /** The gusting strength, not the nominal one: this is what a sampler should feel. */
  readonly strength: number;
}

const CALM: WindSample = { direction: [0, 0, 0], strength: 0 };

/**
 * What another primitive feels at this frame. Absent wind field means dead calm rather
 * than an error: a rain emitter mounted on its own is a legal world.
 */
export function sampleWind(world: WorldHandle): WindSample {
  const slice = readState(world, WIND_STATE_PATH);
  if (slice === null || typeof slice !== 'object') return CALM;
  const { direction, gust, strength } = slice as Record<string, unknown>;
  if (!Array.isArray(direction)) return CALM;
  const felt = typeof gust === 'number' ? gust : typeof strength === 'number' ? strength : 0;
  return {
    direction: [Number(direction[0] ?? 0), Number(direction[1] ?? 0), Number(direction[2] ?? 0)],
    strength: felt,
  };
}

/**
 * Unit-length where possible. Normalizing can only shrink a component whose magnitude
 * exceeds one and can never push one past it, so the catalogue's [-1, 1]^3 bound holds
 * for every input the schema admits — including the zero vector, which stays zero
 * because "no direction" is a legitimate thing to ask for.
 */
function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) return v;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** The catalogue-default instance. Fresh instances come from `createWindField()`. */
export const windField = createWindField();
