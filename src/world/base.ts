/**
 * WS5 · The shared body of every catalogue primitive.
 *
 * The catalogue (`src/intent/catalogue.ts`) declares six primitives as data: a name, a
 * JSON-Schema parameter set, a `statePath`, and the role-tagged fields of the state
 * slice each one maintains. This module turns one of those declarations into a real
 * `Primitive` — and, more importantly, is the single place where the properties L2
 * asserts over are actually guaranteed:
 *
 *   - **Validation at `mount()`.** L0 validates parameters before a candidate runs, but
 *     a primitive reached by any other path (a test, a restore, WS2 replaying a verb)
 *     must not silently accept `count: 5e9`. Out-of-range parameters produce an
 *     explained throw here rather than a `NaN` that surfaces four layers away.
 *
 *   - **Every declared field is present from frame zero.** `slice()` is filled during
 *     `mount()`, not on the first `update()`. A contract snapshotted before any frame
 *     ran would otherwise read `undefined` and fail an `exists` assertion for a
 *     primitive that is in fact correct.
 *
 *   - **`dispose()` removes the slice.** R-4 makes the blob-URL module leak structural,
 *     so the instance is the only thing that can be freed. Disposal unregisters from
 *     the world, which deletes the state slice and prunes the containers it created;
 *     what remains afterwards is exactly the user's own state (AC-12, AC-15).
 *
 *   - **A disposed instance is inert.** `update()` after `dispose()` is a no-op. A
 *     leaked instance that keeps ticking is a live failure, not a slow leak.
 *
 * No renderer is imported anywhere in this workstream. Primitives compute and publish
 * state; binding that state to Three.js is a later, separately-verified step. Keeping
 * the state layer free of a GPU dependency is what lets the layer that decides
 * correctness run in plain Node CI.
 */
import type { Primitive, PrimitiveInstance, WorldHandle } from '../contracts.js';
import { CATALOGUE, findPrimitive, type PrimitiveSpec } from '../intent/catalogue.js';
import { validateParams, type ParamViolation } from '../intent/schema.js';
import { hashSeed, makeRng, type Rng } from './prng.js';

/** Parameters as they arrive from a compiled intent: unvalidated until `mount()`. */
export type Params = Readonly<Record<string, unknown>>;

/**
 * The largest step a primitive will integrate in one `update()`.
 *
 * A frame long enough to skip a whole wrap period would leave a wrapping `animated`
 * field reading identically in the before and after snapshots — "present but inert",
 * the dominant real failure mode behind R-1 — except produced by the harness rather
 * than by the code under test. Clamping is what fixed-step integrators do anyway; here
 * it is also what keeps an animated field honestly animated.
 */
export const MAX_STEP_SECONDS = 1 / 15;

export class ParamValidationError extends Error {
  constructor(
    readonly primitive: string,
    readonly violations: readonly ParamViolation[],
  ) {
    super(
      `'${primitive}' cannot be mounted with these parameters: ` +
        violations.map((v) => v.detail).join('; '),
    );
    this.name = 'ParamValidationError';
  }
}

/** What a primitive body is handed. `rng` is seeded; nothing else is available. */
export interface MountContext {
  readonly id: string;
  readonly spec: PrimitiveSpec;
  /** Validated and defaulted. Reading a declared key is safe by construction. */
  readonly params: Params;
  readonly world: WorldHandle;
  readonly rng: Rng;
}

/**
 * The per-primitive half: the initial slice, and one clamped step of it.
 *
 * `initial` must return every field the catalogue declares for this primitive; a
 * missing one is a contract failure the moment L2 looks, so `definePrimitive()`
 * checks it here rather than letting it be discovered by an oracle later.
 */
export interface PrimitiveBody {
  initial(ctx: MountContext): Record<string, unknown>;
  /** Omitted by primitives the catalogue declares no `animated` field for. */
  step?(state: Record<string, unknown>, dt: number, ctx: MountContext): void;
}

export interface PrimitiveOptions {
  /**
   * Base seed. Instances of the same primitive get distinct streams from their
   * ordinal, so two mounted rain emitters do not fall in lockstep while the pair
   * stays reproducible run to run.
   */
  readonly seed?: number;
}

export const DEFAULT_SEED = 0x5e1f;

class CatalogueInstance implements PrimitiveInstance {
  #slice: Record<string, unknown> | null = null;
  #ctx: MountContext | null = null;

  constructor(
    readonly id: string,
    private readonly body: PrimitiveBody,
  ) {}

  /** Called by `mountInto()` once `register()` has created the slice. */
  attach(ctx: MountContext, slice: Record<string, unknown>): void {
    this.#ctx = ctx;
    this.#slice = slice;
  }

  get disposed(): boolean {
    return this.#slice === null;
  }

  update(dt: number): void {
    const slice = this.#slice;
    const ctx = this.#ctx;
    if (slice === null || ctx === null) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.body.step?.(slice, Math.min(dt, MAX_STEP_SECONDS), ctx);
  }

  /**
   * Idempotent, and re-entrant with `World.unregister()`: the world disposes on
   * unregister, and unregistering is how a primitive's slice is removed, so the two
   * have to be able to call each other exactly once (R-4).
   */
  dispose(): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    this.#slice = null;
    this.#ctx = null;
    ctx.world.unregister(this.id);
  }
}

/**
 * Builds the `Primitive` for one catalogue entry.
 *
 * The spec is read from the catalogue rather than restated here. That is the point of
 * the catalogue being data: WS4 generates the contract from the same declaration WS5
 * implements, so there is no second copy of the schema to drift out of agreement.
 */
export function definePrimitive(
  name: string,
  body: PrimitiveBody,
  options: PrimitiveOptions = {},
): Primitive<Params> {
  const spec = findPrimitive(CATALOGUE, name);
  if (!spec) {
    throw new Error(`'${name}' is not in the primitive catalogue; WS5 may not invent one (D-2)`);
  }
  const baseSeed = options.seed ?? DEFAULT_SEED;
  let ordinal = 0;

  return {
    name: spec.name,
    schema: spec.schema,
    statePath: spec.statePath,
    mount(world: WorldHandle, params: Params): PrimitiveInstance {
      const { params: resolved, violations } = validateParams(spec.schema, spec.defaults, params);
      if (violations.length > 0) throw new ParamValidationError(spec.name, violations);

      // Ids are `<name>#<n>`, matching the catalogue's declared resource witness, and
      // they are allocated per primitive so a run is reproducible from the seed alone.
      const id = `${spec.name}#${ordinal++}`;
      const instance = new CatalogueInstance(id, body);
      const ctx: MountContext = {
        id,
        spec,
        params: resolved,
        world,
        rng: makeRng(hashSeed(spec.name, id, baseSeed)),
      };

      world.register(instance, spec.statePath);
      const slice = world.slice(id);
      Object.assign(slice, body.initial(ctx));
      assertDeclaredFields(spec, slice);
      instance.attach(ctx, slice);
      return instance;
    },
  };
}

/**
 * Every field the catalogue declares must exist the instant the primitive is mounted.
 *
 * This is the disagreement that would otherwise be found by the oracle: WS4 derives an
 * assertion per declared field, so a field this implementation forgot becomes a
 * contract failure blamed on the candidate rather than on the primitive. Failing loudly
 * at `mount()` puts the error where the mistake is.
 */
function assertDeclaredFields(spec: PrimitiveSpec, slice: Record<string, unknown>): void {
  const missing = spec.fields.filter((f) => slice[f.key] === undefined).map((f) => f.key);
  if (missing.length > 0) {
    throw new Error(
      `'${spec.name}' did not publish declared state field(s) [${missing.join(', ')}] at ` +
        `'${spec.statePath}'. The catalogue declares them, so a contract asserts over them.`,
    );
  }
}

/**
 * Reads a dotted path out of the world's observable state.
 *
 * Primitives *read* across slices — rain couples to wind — but write only inside their
 * own, which is what AC-05 checks and what makes exclusive path ownership meaningful.
 */
export function readState(world: WorldHandle, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, world.state);
}

// ─── parameter readers ───────────────────────────────────────────────────────
// `validateParams` has already proved the type and the range; these narrow without
// re-deciding anything, so there is exactly one validator in the system.

export function num(params: Params, key: string): number {
  const v = params[key];
  if (typeof v !== 'number') throw new Error(`parameter '${key}' is not a number after validation`);
  return v;
}

export function str(params: Params, key: string): string {
  const v = params[key];
  if (typeof v !== 'string') throw new Error(`parameter '${key}' is not a string after validation`);
  return v;
}

/** A defensive copy: state must never alias an intent's parameter object. */
export function vec3(params: Params, key: string): [number, number, number] {
  const v = params[key];
  if (!Array.isArray(v) || v.length !== 3) {
    throw new Error(`parameter '${key}' is not a 3-vector after validation`);
  }
  return [Number(v[0]), Number(v[1]), Number(v[2])];
}
