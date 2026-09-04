/**
 * WS5 · `skyline-shift` — rescales the authored city: taller, denser or sparser.
 *
 * Catalogue slice `structures.skyline`:
 *   heightScale  constant  the requested height multiplier
 *   density      constant  the requested density multiplier
 *   shiftPhase   animated  the shift clock; must move between snapshots
 *   instance     resource  present while mounted, gone after dispose()
 *
 * The one primitive here that changes something the user was already looking at. Every
 * other entry adds; this one takes the base scene's own skyline and moves it, which is
 * why its binding is the only one that needs a handle onto authored geometry
 * (`BaseScene.skyline`). The seam still holds in the direction that matters: this
 * module computes numbers and imports no renderer, and the binding is the only code
 * that knows an `InstancedMesh` exists.
 *
 * `heightNow` and `densityNow` are published beside the requested values rather than
 * instead of them. The contract asserts over the *requested* multipliers — that is what
 * `constant` means, and a field that eased towards its target would fail an `equals`
 * assertion for the whole first second of a correct shift. The eased values are the
 * binding's business; the requested ones are the oracle's.
 *
 * `shiftPhase` is the animated witness for the reason spelled out in `tower.ts`:
 * `blend` reaches 1 and then correctly stops moving, so asserting change over it would
 * make the primary oracle (D-1) pass or fail on when the window happened to fall.
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';

export const SKYLINE_STATE_PATH = 'structures.skyline';

/** Seconds the city takes to reach the requested shape. */
const SHIFT_SECONDS = 3;

export function createSkylineShift(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'skyline-shift',
    {
      initial(ctx) {
        return {
          heightScale: num(ctx.params, 'heightScale'),
          density: num(ctx.params, 'density'),
          shiftPhase: 0,
          blend: 0,
          // Starting at 1: the authored city is the state the user is already looking
          // at, so frame zero of the shift has to be a no-op or the verb lands as a
          // jump cut (AC-14 is about injection, but the same argument is why).
          heightNow: 1,
          densityNow: 1,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const heightScale = num(ctx.params, 'heightScale');
        const density = num(ctx.params, 'density');
        const phase = (state['shiftPhase'] as number) + dt;
        const blend = ease(clamp01(phase / SHIFT_SECONDS));

        state['shiftPhase'] = phase;
        state['blend'] = blend;
        state['heightNow'] = 1 + (heightScale - 1) * blend;
        state['densityNow'] = 1 + (density - 1) * blend;
      },
    },
    options,
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep: buildings that grow at a constant rate start and stop with a jerk. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The catalogue-default instance. Fresh instances come from `createSkylineShift()`. */
export const skylineShift = createSkylineShift();
