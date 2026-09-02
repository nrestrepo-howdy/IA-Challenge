/**
 * WS5 · `ambient-light` — uniform fill light; the brightness verb.
 *
 * Catalogue slice `lighting.ambient`:
 *   intensity  constant  the requested intensity
 *   color      vector    inside [0, 1]^3
 *   instance   resource  present while mounted, gone after dispose()
 *
 * Static, like `fog-volume`: the catalogue declares no animated field, so there is no
 * `step()`. What this primitive owes its contract is that the number it publishes is
 * the number that was asked for — which is the whole point of the `constant` role.
 */
import { definePrimitive, num, vec3, type PrimitiveOptions } from './base.js';

export const AMBIENT_STATE_PATH = 'lighting.ambient';

export function createAmbientLight(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'ambient-light',
    {
      initial(ctx) {
        return {
          intensity: num(ctx.params, 'intensity'),
          color: vec3(ctx.params, 'color'),
          instance: ctx.id,
        };
      },
    },
    options,
  );
}

/** The catalogue-default instance. Fresh instances come from `createAmbientLight()`. */
export const ambientLight = createAmbientLight();
