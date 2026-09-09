/**
 * WS5 · `flock` — moving life over the city.
 *
 * Catalogue slice `life.flock`:
 *   birds        constant  the requested number of animals
 *   speed        constant  the requested cruise speed, in world units per second
 *   altitude     constant  the requested cruise height
 *   flightPhase  animated  distance flown; must move between snapshots
 *   instance     resource  present while mounted, gone after dispose()
 *
 * Every other primitive in the catalogue changes the weather, the light, or the
 * buildings. This is the first one that puts something *alive* in the frame, and the
 * standard it has to meet is different: a static swarm is worse than no swarm, because
 * a still bird does not read as a bird at all. So the requirement is continuous motion
 * that never arrives anywhere — which is also, conveniently, exactly what an `animated`
 * field is supposed to be.
 *
 * What is published, and why it is these things:
 *
 *   - `flightPhase` is arc length flown, `speed * dt` accumulated. It is the animated
 *     witness because it is monotonic for every parameter the schema admits (the
 *     minimum speed is 1, so it can never stall) and because it is the value the
 *     picture is genuinely a function of. Nothing here eases into place, but the rule
 *     from `lightning.ts` still decides the choice: the witness is a clock, never a
 *     quantity that could arrive.
 *   - `centroid` and `heading` are where the flock is and which way it is going. The
 *     binding scatters birds around that point; publishing 400 positions per frame
 *     instead would put a kilobyte of geometry through `structuredClone()` on every
 *     contract snapshot to say something two vectors already say.
 *   - `wingPhase` is a separate seconds clock. Flapping is not a function of ground
 *     speed — a slow flock still beats its wings — and a wingbeat driven by
 *     `flightPhase` would freeze a hovering swarm mid-stroke.
 *
 * The path is a pure function of `flightPhase` and the parameters: no `Math.random()`,
 * and deliberately not the seeded stream either, because it is recomputed every step
 * and drawing from a stream there would advance it once per frame and walk the flock
 * out from under itself — the argument `tower.ts` makes about its layout.
 */
import { definePrimitive, num, type PrimitiveOptions } from './base.js';

export const FLOCK_STATE_PATH = 'life.flock';

/**
 * Radius of the circuit, in world units. Outside the camera's orbit (dolly ~150) and
 * inside the authored skyline's inner ring (170), so the flock crosses in front of the
 * city rather than behind it or through the lens.
 */
const PATH_RADIUS = 300;

/** How far the circuit wanders in and out of that radius, as a fraction of it. */
const WANDER = 0.22;

/** Wingbeats per second. Fast enough to read as a bird, slow enough not to strobe. */
const FLAP_HZ = 3.1;

export function createFlock(options: PrimitiveOptions = {}) {
  return definePrimitive(
    'flock',
    {
      initial(ctx) {
        const altitude = num(ctx.params, 'altitude');
        const count = num(ctx.params, 'count');
        const start = path(0, altitude);
        return {
          birds: count,
          speed: num(ctx.params, 'speed'),
          altitude,
          flightPhase: 0,
          wingPhase: 0,
          centroid: start.position,
          heading: start.heading,
          // How far the birds spread around the centroid. A hundred animals in the
          // volume of ten is a cloud, not a flock, so the radius grows with the count.
          spread: 26 + Math.cbrt(count) * 7,
          instance: ctx.id,
        };
      },
      step(state, dt, ctx) {
        const speed = num(ctx.params, 'speed');
        const altitude = num(ctx.params, 'altitude');

        const flown = (state['flightPhase'] as number) + speed * dt;
        state['flightPhase'] = flown;
        state['wingPhase'] = (state['wingPhase'] as number) + FLAP_HZ * dt;

        const at = path(flown, altitude);
        state['centroid'] = at.position;
        state['heading'] = at.heading;
      },
    },
    options,
  );
}

/**
 * Where the flock is after flying `distance`, and which way it is pointing.
 *
 * The circuit breathes in and out rather than being a circle: a flock on a perfect
 * ring reads as a carousel, and the eye finds the repetition within one lap.
 */
function path(distance: number, altitude: number): {
  position: [number, number, number];
  heading: number;
} {
  const angle = distance / PATH_RADIUS;
  const here = point(angle, altitude);
  // The tangent, from a step small enough to be a derivative and large enough to
  // survive single-precision. Differentiating the wander by hand would be a second
  // expression of the same curve, free to disagree with the first one.
  const ahead = point(angle + 1e-3, altitude);
  return {
    position: here,
    heading: Math.atan2(ahead[2] - here[2], ahead[0] - here[0]),
  };
}

function point(angle: number, altitude: number): [number, number, number] {
  const radius = PATH_RADIUS * (1 + WANDER * Math.sin(angle * 3));
  return [
    Math.cos(angle) * radius,
    altitude * (1 + 0.14 * Math.sin(angle * 2 + 0.7)),
    Math.sin(angle) * radius,
  ];
}

/** The catalogue-default instance. Fresh instances come from `createFlock()`. */
export const flock = createFlock();
