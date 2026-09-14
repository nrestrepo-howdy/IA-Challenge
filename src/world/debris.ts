/**
 * Falling bodies: the first primitive whose correctness is a *physical* law.
 *
 * Everything else in this world is authored motion — a sine for a walk, a ramp for a
 * dawn. This one integrates: bodies have velocity, gravity pulls, the ground stops them
 * and takes energy out of the bounce. Nothing about that is decorative, and that is why
 * it is here: it gives L2 something to assert that no other primitive can offer.
 *
 * **Energy never increases.** A semi-implicit Euler integrator with a restitution below
 * one is dissipative, so total mechanical energy falls monotonically from the moment the
 * bodies are released. That invariant is invisible in a screenshot — a world where
 * bodies gain energy every bounce looks *more* lively, not broken, until the tenth
 * second when they leave the frame — and it is exactly the class of failure
 * WorldCoder-Bench reports as dominant: state drifting out of agreement with what the
 * scene appears to show. `tests/world/debris.test.ts` holds it.
 *
 * Deterministic, like every other primitive here: the same seed gives the same numbers,
 * so a contract that passed once passes again.
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';

export const DEBRIS_STATE_PATH = 'physics.debris';

/** Metres per second squared, in this world's units. Tuned to look like falling. */
const GRAVITY = 34;
/** Below this speed after a bounce, a body is put to rest rather than jittered forever. */
const SLEEP_SPEED = 0.9;
/** Air drag per second. Small: without it the tallest drops reach a comic terminal speed. */
const DRAG = 0.12;

export function createDebris(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'debris',
    {
      initial(ctx) {
        const count = Math.round(num(ctx.params, 'count'));
        const height = num(ctx.params, 'height');
        const spread = num(ctx.params, 'spread');

        // Flat arrays rather than objects: this is the state a contract reads every
        // frame and a binding walks every frame, and an array of `count` objects is a
        // garbage-collection problem dressed as a data structure.
        const bodies: number[] = [];
        const velocity: number[] = [];
        for (let i = 0; i < count; i++) {
          const a = ctx.rng() * Math.PI * 2;
          const r = Math.sqrt(ctx.rng()) * spread;
          bodies.push(Math.cos(a) * r, height * (0.6 + ctx.rng() * 0.8), Math.sin(a) * r);
          // A little sideways drift so they do not fall in perfect columns.
          velocity.push((ctx.rng() - 0.5) * 6, 0, (ctx.rng() - 0.5) * 6);
        }

        return {
          count,
          bounce: num(ctx.params, 'bounce'),
          size: num(ctx.params, 'size'),
          bodies,
          velocity,
          // Potential plus kinetic, in arbitrary units. Published because it is the
          // assertion: it must fall, and a world that gains it is wrong in a way no
          // frame shows.
          energy: totalEnergy(bodies, velocity),
          atRest: 0,
          instance: ctx.id,
        };
      },

      step(state, dt, ctx) {
        const bodies = state['bodies'] as number[];
        const velocity = state['velocity'] as number[];
        const bounce = Math.max(0, Math.min(0.9, num(ctx.params, 'bounce')));
        const radius = num(ctx.params, 'size') / 2;
        // Clamped: a frame that took a second — a tab coming back from the background —
        // would otherwise integrate a body through the floor in one step.
        const h = Math.min(dt, 1 / 30);
        let resting = 0;

        for (let i = 0; i < bodies.length; i += 3) {
          let vx = velocity[i]!, vy = velocity[i + 1]!, vz = velocity[i + 2]!;
          let x = bodies[i]!, y = bodies[i + 1]!, z = bodies[i + 2]!;

          if (y <= radius && Math.abs(vy) < SLEEP_SPEED) {
            // Asleep. Held exactly at rest rather than integrated with a tiny velocity,
            // which is what makes a pile settle instead of shivering.
            bodies[i + 1] = radius;
            velocity[i] = velocity[i + 1] = velocity[i + 2] = 0;
            resting += 1;
            continue;
          }

          vy -= GRAVITY * h;
          const drag = 1 - DRAG * h;
          vx *= drag; vy *= drag; vz *= drag;
          x += vx * h; y += vy * h; z += vz * h;

          if (y < radius) {
            y = radius;
            // Restitution below 1 is what makes this dissipative, which is what makes
            // the energy assertion hold. Friction on the tangent for the same reason.
            vy = -vy * bounce;
            vx *= 0.72; vz *= 0.72;
          }

          bodies[i] = x; bodies[i + 1] = y; bodies[i + 2] = z;
          velocity[i] = vx; velocity[i + 1] = vy; velocity[i + 2] = vz;
        }

        state['atRest'] = resting;
        state['energy'] = totalEnergy(bodies, velocity);
      },
    },
    options,
  );
}

/** Potential + kinetic. The quantity the contract watches. */
function totalEnergy(bodies: readonly number[], velocity: readonly number[]): number {
  let e = 0;
  for (let i = 0; i < bodies.length; i += 3) {
    const vx = velocity[i]!, vy = velocity[i + 1]!, vz = velocity[i + 2]!;
    e += GRAVITY * Math.max(0, bodies[i + 1]!) + 0.5 * (vx * vx + vy * vy + vz * vz);
  }
  return e;
}
