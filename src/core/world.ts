/**
 * WS1 core · the world registry.
 *
 * This module owns the scene, the frame tick, and `__VERBO_STATE__` — the observable
 * state L2 asserts over. It is the boundary that makes the verification architecture
 * possible at all: a `StateContract` addresses dotted paths inside this tree, and
 * those paths exist because a primitive declared and registered one (D-1, D-2).
 *
 * Two properties are load-bearing, and both are enforced here rather than left to
 * convention:
 *
 *   1. **Path ownership is exclusive.** If two primitives could write the same slice,
 *      an assertion over that slice would be answering a question about whichever one
 *      ran last — a non-deterministic oracle, which is no oracle. Registering an
 *      overlapping path throws.
 *
 *   2. **Unregistering disposes.** ES modules imported via blob URL can never be
 *      released (R-4), so the instance is the only thing that can actually be freed.
 *      A leaked instance still ticking is a live failure, not a slow leak.
 *
 * Deliberately renderer-agnostic: `scene` is `unknown` in the contract, WS5 supplies
 * the Three.js object later. Keeping this layer free of a GPU dependency is what lets
 * the state layer — the layer that decides correctness — be verified in plain Node CI.
 */
import type { PrimitiveInstance, WorldHandle, WorldSnapshot } from '../contracts.js';

/** A verb is one accepted injection: what the user said, and the code it became. */
export type Verb = WorldSnapshot['verbs'][number];

interface Registration {
  readonly instance: PrimitiveInstance;
  readonly statePath: string;
}

export class PathOwnershipError extends Error {
  constructor(
    readonly requestedPath: string,
    readonly ownedPath: string,
    readonly ownerId: string,
  ) {
    super(
      `state path '${requestedPath}' overlaps '${ownedPath}', already owned by instance ` +
        `'${ownerId}'. Two primitives writing one path makes every contract over it ` +
        `non-deterministic, so this is an error rather than a silent overwrite.`,
    );
    this.name = 'PathOwnershipError';
  }
}

export class World implements WorldHandle {
  readonly scene: unknown;

  #elapsed = 0;
  #state: Record<string, unknown> = {};
  /** Insertion order. Map iteration order is the tick order, and it is specified. */
  readonly #registry = new Map<string, Registration>();
  /**
   * Containers this registry created to hold a slice, so removal can undo exactly
   * them. Anything else in the tree belongs to the user and is never pruned (AC-12).
   */
  #scaffolding = new Set<string>();
  #verbs: Verb[] = [];

  constructor(scene: unknown = {}) {
    this.scene = scene;
  }

  get clock(): { readonly elapsed: number } {
    return { elapsed: this.#elapsed };
  }

  get state(): Readonly<Record<string, unknown>> {
    return this.#state;
  }

  /** Accepted injections, oldest first. Replayed on restore (AC-20). */
  get verbs(): readonly Verb[] {
    return this.#verbs;
  }

  /** Ids of every mounted instance, in tick order. */
  get instanceIds(): readonly string[] {
    return [...this.#registry.keys()];
  }

  // ─── registration ──────────────────────────────────────────────────────────

  register(inst: PrimitiveInstance, statePath: string): void {
    const segments = parsePath(statePath);

    if (this.#registry.has(inst.id)) {
      throw new Error(`instance '${inst.id}' is already registered`);
    }

    for (const [id, reg] of this.#registry) {
      if (overlaps(statePath, reg.statePath)) {
        throw new PathOwnershipError(statePath, reg.statePath, id);
      }
    }

    // A collision with state nobody registered — user state, or a leftover — is the
    // same hazard seen from the other side: the primitive would clobber it.
    const existing = readPath(this.#state, statePath);
    if (existing !== undefined && !isEmptyObject(existing)) {
      throw new PathOwnershipError(statePath, statePath, '<unregistered state>');
    }

    for (const path of this.#ensureContainers(segments)) this.#scaffolding.add(path);
    this.#registry.set(inst.id, { instance: inst, statePath });
  }

  unregister(id: string): void {
    const reg = this.#registry.get(id);
    if (reg === undefined) return;

    this.#registry.delete(id);
    // Dispose before the slice disappears: a disposer may want to read its own state.
    reg.instance.dispose();
    deleteIn(this.#state, reg.statePath);
    this.#scaffolding.delete(reg.statePath);
    pruneScaffolding(this.#state, this.#scaffolding);
  }

  /**
   * The live, mutable slice a primitive writes into.
   *
   * Handing out the object rather than a setter is what keeps `state` readable by
   * `readPath()` with no copying between the write and the assertion: what L2 reads
   * is the same object the primitive is updating.
   */
  slice(id: string): Record<string, unknown> {
    const reg = this.#registry.get(id);
    if (reg === undefined) throw new Error(`instance '${id}' is not registered`);
    return readPath(this.#state, reg.statePath) as Record<string, unknown>;
  }

  // ─── frame ─────────────────────────────────────────────────────────────────

  /**
   * Advances the clock and updates every instance in registration order.
   *
   * The order is specified, not incidental: an oracle that replays the same frames
   * has to get the same state back, or contract results stop being reproducible.
   *
   * A throwing instance does not cancel the rest of the frame — starving later
   * primitives would turn one bad injection into a whole-world stall — but the error
   * is re-thrown once the frame is complete so the injector can roll back (AC-13).
   */
  tick(dt: number): void {
    this.#elapsed += dt;
    let firstError: unknown;
    let failed = false;
    for (const reg of [...this.#registry.values()]) {
      try {
        reg.instance.update(dt);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
    if (failed) throw firstError;
  }

  // ─── serialization (AC-20) ─────────────────────────────────────────────────

  /**
   * A world is its verbs plus the state the user made, not its live object graph.
   *
   * Primitive-owned slices are deliberately excluded: they are reconstructed by
   * replaying the verbs, and serializing them as well would let a restore produce a
   * world whose state disagrees with the code that is supposed to be maintaining it.
   */
  snapshot(): WorldSnapshot {
    return {
      version: 1,
      verbs: this.#verbs.map((v) => ({ ...v })),
      userState: this.#userState(),
    };
  }

  /**
   * Restores user state and the verb log. Re-executing the verb sources is WS2's
   * job — this layer holds no code loader — so `verbs` is the replay list, and a
   * restored world snapshots identically once the same verbs are applied.
   */
  restore(s: WorldSnapshot): void {
    if (s.version !== 1) {
      throw new Error(`unsupported snapshot version ${String(s.version)}`);
    }
    for (const id of this.instanceIds) this.unregister(id);
    this.#scaffolding = new Set();
    this.#state = (clone(s.userState) as Record<string, unknown> | null) ?? {};
    this.#verbs = s.verbs.map((v) => ({ ...v }));
    this.#elapsed = 0;
  }

  /** Records an accepted injection so it survives serialization (AC-20). */
  recordVerb(verb: Verb): void {
    this.#verbs.push({ ...verb });
  }

  /**
   * Writes state that is the user's rather than a primitive's — camera, inputs,
   * objects they created. It is exactly this that AC-12 requires an injection to
   * leave identical, which is why it is kept out of every primitive's reach.
   */
  setUserState(path: string, value: unknown): void {
    const segments = parsePath(path);
    for (const [id, reg] of this.#registry) {
      if (overlaps(path, reg.statePath)) {
        throw new PathOwnershipError(path, reg.statePath, id);
      }
    }
    const leaf = segments[segments.length - 1]!;
    const parentSegments = segments.slice(0, -1);
    this.#ensureContainers(parentSegments);
    const parent = parentSegments.length === 0
      ? this.#state
      : (readPath(this.#state, parentSegments.join('.')) as Record<string, unknown>);
    parent[leaf] = value;
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /** Creates `{}` for each missing segment; returns the paths it had to create. */
  #ensureContainers(segments: readonly string[]): string[] {
    const created: string[] = [];
    let node: Record<string, unknown> = this.#state;
    const walked: string[] = [];
    for (const key of segments) {
      walked.push(key);
      const next = node[key];
      if (next === undefined) {
        const fresh: Record<string, unknown> = {};
        node[key] = fresh;
        created.push(walked.join('.'));
        node = fresh;
      } else if (typeof next === 'object' && next !== null) {
        node = next as Record<string, unknown>;
      } else {
        throw new Error(`state path '${walked.join('.')}' is occupied by a non-object value`);
      }
    }
    return created;
  }

  /** The state tree with every primitive-owned slice pruned out. */
  #userState(): Record<string, unknown> {
    const copy = clone(this.#state) as Record<string, unknown>;
    const scaffolding = new Set(this.#scaffolding);
    for (const reg of this.#registry.values()) {
      deleteIn(copy, reg.statePath);
      scaffolding.delete(reg.statePath);
    }
    pruneScaffolding(copy, scaffolding);
    return copy;
  }
}

/** Mirrors `readPath()` in the L2 oracle exactly; the two must agree or L2 reads air. */
function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

function deleteIn(root: Record<string, unknown>, path: string): void {
  const segments = path.split('.');
  const leaf = segments[segments.length - 1]!;
  const parent = segments.length === 1
    ? root
    : readPath(root, segments.slice(0, -1).join('.'));
  if (parent !== null && typeof parent === 'object') {
    delete (parent as Record<string, unknown>)[leaf];
  }
}

/**
 * Drops container objects the registry created that no longer hold anything.
 *
 * Deepest first, so a chain collapses in one pass. Without this, removing a primitive
 * would leave `weather: {}` behind and a restored world would not compare equal to the
 * one it came from (AC-12, AC-20).
 */
function pruneScaffolding(root: Record<string, unknown>, paths: Set<string>): void {
  for (const path of [...paths].sort((a, b) => b.split('.').length - a.split('.').length)) {
    if (isEmptyObject(readPath(root, path))) deleteIn(root, path);
  }
}

function parsePath(path: string): string[] {
  const segments = path.split('.');
  if (path.length === 0 || segments.some((s) => s.length === 0)) {
    throw new Error(`invalid state path '${path}': segments must be non-empty`);
  }
  return segments;
}

/** True when either path is the other, or nests inside it. */
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

function isEmptyObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}
