/**
 * WS5 · `fog-volume` — exponential distance fog over the base scene.
 *
 * Catalogue slice `atmosphere.fog`:
 *   density   constant  the requested density
 *   color     vector    inside [0, 1]^3
 *   instance  resource  present while mounted, gone after dispose()
 *
 * The catalogue declares no `animated` field here, so this primitive has no `step()`
 * and its contract contains no `changesOverTime` assertion. That is the correct
 * outcome, not a gap: fog is a static property of the atmosphere, and inventing
 * motion for it only to satisfy a stronger-looking contract would be the primitive
 * lying to its own oracle.
 */
import { definePrimitive, num, vec3, type PrimitiveOptions } from './base.js';

export const FOG_STATE_PATH = 'atmosphere.fog';

export function createFogVolume(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'fog-volume',
    {
      initial(ctx) {
        return {
          density: num(ctx.params, 'density'),
          // `vec3` copies: aliasing the intent's parameter array would let a later
          // mutation of the intent silently rewrite live world state.
          color: vec3(ctx.params, 'color'),
          instance: ctx.id,
        };
      },
    },
    options,
  );
}

/** The catalogue-default instance. Fresh instances come from `createFogVolume()`. */
export const fogVolume = createFogVolume();
