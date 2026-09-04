/**
 * WS5 · `ground-tint` — restates what the ground is made of.
 *
 * Catalogue slice `surface.ground`:
 *   color      vector    the requested colour, inside [0, 1]^3
 *   roughness  constant  the requested roughness
 *   tintPhase  animated  the soak clock; must move between snapshots
 *   instance   resource  present while mounted, gone after dispose()
 *
 * "Make it a desert" and "make it obsidian" are requests about the *material* of the
 * world, not about its weather, and before this entry the catalogue had no way to say
 * either. Colour and roughness together are what carry that: sand is bright and matte,
 * obsidian is dark and sharp, and a primitive that only tinted would make them the same
 * surface in two colours.
 *
 * The published `color` is the requested one, unmodified — `vector` means bounded, and
 * `constant`-like pinning is exactly what proves the code used the value it was asked
 * for. The blend towards it lives in `mix`, which the binding uses to cross-fade from
 * whatever the ground already was. `tintPhase` is the animated witness rather than
 * `mix` for the reason `tower.ts` sets out: `mix` saturates at 1 and correctly stops.
 */
import { definePrimitive, num, vec3, type PrimitiveOptions } from './base.js';

export const GROUND_STATE_PATH = 'surface.ground';

/** Seconds for the new material to take over completely. */
const SOAK_SECONDS = 2.2;

export function createGroundTint(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'ground-tint',
    {
      initial(ctx) {
        return {
          // `vec3` copies: aliasing the intent's parameter array would let a later
          // mutation of the intent silently rewrite live world state.
          color: vec3(ctx.params, 'color'),
          roughness: num(ctx.params, 'roughness'),
          tintPhase: 0,
          mix: 0,
          instance: ctx.id,
        };
      },
      step(state, dt) {
        const phase = (state['tintPhase'] as number) + dt;
        state['tintPhase'] = phase;
        state['mix'] = ease(clamp01(phase / SOAK_SECONDS));
      },
    },
    options,
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep: a linear cross-fade reads as a wipe, not as a change of substance. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The catalogue-default instance. Fresh instances come from `createGroundTint()`. */
export const groundTint = createGroundTint();
