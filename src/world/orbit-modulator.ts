/**
 * WS5 · `orbit-modulator` — drives an object around a circular path.
 *
 * Catalogue slice `motion.orbit`:
 *   speed     constant  the requested angular speed
 *   axis      constant  the requested axis
 *   angle     animated  must move between snapshots
 *   instance  resource  present while mounted, gone after dispose()
 *
 * `angle` is the total swept angle and is never wrapped into [0, 2*pi). A wrapped angle
 * can land back on its previous value across a snapshot window and read as inert while
 * the object is orbiting correctly — a false rejection by the layer that decides
 * correctness (D-1), which is worse than a weak assertion. The wrapped angle and the
 * resulting position are published beside it for whatever binds this to a transform.
 */
import { definePrimitive, num, str, type PrimitiveOptions } from './base.js';

const TAU = Math.PI * 2;

export const ORBIT_STATE_PATH = 'motion.orbit';

export function createOrbitModulator(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'orbit-modulator',
    {
      initial(ctx) {
        const radius = num(ctx.params, 'radius');
        const axis = str(ctx.params, 'axis');
        // A seeded starting angle: two orbiters mounted together should not sit on top
        // of each other, and the offset has to survive a replay unchanged.
        const angle = ctx.rng() * TAU;
        return {
          speed: num(ctx.params, 'speed'),
          radius,
          axis,
          angle,
          wrappedAngle: angle % TAU,
          position: positionOn(axis, radius, angle),
          elapsed: 0,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const speed = num(ctx.params, 'speed');
        const radius = num(ctx.params, 'radius');
        const axis = str(ctx.params, 'axis');
        const angle = (state['angle'] as number) + speed * dt;

        state['elapsed'] = (state['elapsed'] as number) + dt;
        state['angle'] = angle;
        state['wrappedAngle'] = angle % TAU;
        state['position'] = positionOn(axis, radius, angle);
      },
    },
    options,
  );
}

/** The orbital plane is the one perpendicular to the named axis. */
function positionOn(axis: string, radius: number, angle: number): [number, number, number] {
  const c = Math.cos(angle) * radius;
  const s = Math.sin(angle) * radius;
  switch (axis) {
    case 'x':
      return [0, c, s];
    case 'z':
      return [c, s, 0];
    default:
      return [c, 0, s];
  }
}

/** The catalogue-default instance. Fresh instances come from `createOrbitModulator()`. */
export const orbitModulator = createOrbitModulator();
