/**
 * WS5 · world. The catalogue primitives, made real.
 *
 * The catalogue is the specification: WS4 derives a state contract from the declared
 * fields of an entry, and the implementation here maintains exactly those fields. The
 * end-to-end proof that the two agree is `tests/world/contract-e2e.test.ts`, which
 * compiles a real utterance, mounts the real primitives into a real `World`, ticks it,
 * and evaluates the generated contract with the real L2 oracle. Nothing in this
 * workstream imports a renderer, so all of that runs in plain Node.
 */
import type { Intent, Primitive, PrimitiveDirective, PrimitiveInstance, WorldHandle } from '../contracts.js';
import { CATALOGUE } from '../intent/catalogue.js';
import type { Params, PrimitiveOptions } from './base.js';
import { createAmbientLight } from './ambient-light.js';
import { createFogVolume } from './fog-volume.js';
import { createGroundTint } from './ground-tint.js';
import { createLightning } from './lightning.js';
import { createOrbitModulator } from './orbit-modulator.js';
import { createRainEmitter } from './rain-emitter.js';
import { createSkylineShift } from './skyline-shift.js';
import { createSnowEmitter } from './snow-emitter.js';
import { createTower } from './tower.js';
import { createWindField } from './wind-field.js';

export {
  DEFAULT_SEED,
  MAX_STEP_SECONDS,
  ParamValidationError,
  definePrimitive,
  readState,
} from './base.js';
export type { MountContext, Params, PrimitiveBody, PrimitiveOptions } from './base.js';
export { makeRng, hashSeed } from './prng.js';
export type { Rng } from './prng.js';
export { createAmbientLight, ambientLight, AMBIENT_STATE_PATH } from './ambient-light.js';
export { createFogVolume, fogVolume, FOG_STATE_PATH } from './fog-volume.js';
export { createLightning, lightning, LIGHTNING_STATE_PATH } from './lightning.js';
export { createOrbitModulator, orbitModulator, ORBIT_STATE_PATH } from './orbit-modulator.js';
export { createRainEmitter, rainEmitter, RAIN_STATE_PATH } from './rain-emitter.js';
export { createSnowEmitter, snowEmitter, SNOW_STATE_PATH } from './snow-emitter.js';
export { createWindField, windField, sampleWind, WIND_STATE_PATH } from './wind-field.js';
export { createTower, tower, TOWER_STATE_PATH } from './tower.js';
export { createSkylineShift, skylineShift, SKYLINE_STATE_PATH } from './skyline-shift.js';
export { createGroundTint, groundTint, GROUND_STATE_PATH } from './ground-tint.js';
export type { WindSample } from './wind-field.js';

/** A `name -> Primitive` registry. Closed: it holds the catalogue and nothing else (D-2). */
export type PrimitiveRegistry = ReadonlyMap<string, Primitive<Params>>;

/**
 * A fresh set of primitives.
 *
 * Instance ids and seeded streams are per-`Primitive`, so a test — or a nightly
 * evaluation run — that builds its own set gets the same ids and the same numbers
 * every time regardless of what ran before it. A module-level singleton would make
 * behaviour depend on execution order, which is the cheapest way to turn a
 * deterministic oracle back into a flaky one.
 */
export function createPrimitives(options: PrimitiveOptions = {}): PrimitiveRegistry {
  const all: readonly Primitive<Params>[] = [
    createRainEmitter(options),
    createSnowEmitter(options),
    createWindField(options),
    createFogVolume(options),
    createAmbientLight(options),
    createOrbitModulator(options),
    createLightning(options),
    createTower(options),
    createSkylineShift(options),
    createGroundTint(options),
  ];

  const registry = new Map<string, Primitive<Params>>(all.map((p) => [p.name, p]));

  // The catalogue is the specification, so an entry with no implementation is a build
  // error here rather than an unresolvable import inside a candidate module later.
  const missing = CATALOGUE.filter((spec) => !registry.has(spec.name)).map((s) => s.name);
  if (missing.length > 0) {
    throw new Error(`catalogue entries with no WS5 implementation: ${missing.join(', ')}`);
  }
  return registry;
}

/**
 * Mounts one compiled directive.
 *
 * The directive's `statePath` is checked against the primitive's own declaration: a
 * disagreement would mount the primitive somewhere the contract is not looking, and
 * every assertion would then read `undefined` — a whole-contract failure whose cause is
 * nowhere near where it surfaces.
 */
export function mountDirective(
  world: WorldHandle,
  registry: PrimitiveRegistry,
  directive: PrimitiveDirective,
): PrimitiveInstance {
  const primitive = registry.get(directive.name);
  if (!primitive) {
    throw new Error(
      `'${directive.name}' is not an implemented primitive; the catalogue is closed (D-2)`,
    );
  }
  if (primitive.statePath !== directive.statePath) {
    throw new Error(
      `'${directive.name}' declares '${primitive.statePath}' but the directive asks for ` +
        `'${directive.statePath}'; a contract over the second would assert over nothing`,
    );
  }
  return primitive.mount(world, directive.params);
}

/**
 * Mounts every directive of a compiled intent, in order.
 *
 * A failure part-way through unmounts what already went up. A half-applied intent
 * would leave state the user never asked for behind and make the next `snapshot()`
 * disagree with the verb log (AC-12, AC-20).
 */
export function mountIntent(
  world: WorldHandle,
  registry: PrimitiveRegistry,
  intent: Intent,
): readonly PrimitiveInstance[] {
  const mounted: PrimitiveInstance[] = [];
  try {
    for (const directive of intent.brief.directives) {
      mounted.push(mountDirective(world, registry, directive));
    }
  } catch (err) {
    for (const inst of mounted.reverse()) inst.dispose();
    throw err;
  }
  return mounted;
}
