/**
 * Undo, built on the serialization that already exists.
 *
 * The world is cumulative by design, which makes an unwanted verb permanent unless
 * something can put the world back. `snapshot()`/`restore()` already round-trip a
 * world (AC-20), so undo is a stack of snapshots taken immediately before each
 * accepted injection rather than a second, parallel notion of world state.
 *
 * Restoring is deliberately a *rebuild*, not a diff:
 *
 *   - `World.restore()` unregisters every mounted instance, and unregistering
 *     disposes — the only lever there is, since a blob-URL module record can never be
 *     freed (R-4). Removing a verb therefore actually frees what it mounted.
 *   - The verbs that survive are re-mounted from the sources the snapshot carries, in
 *     their original order, so path ownership is claimed in the same sequence it was
 *     the first time.
 *   - User state is whatever the snapshot recorded, and `snapshot()` already excludes
 *     primitive-owned slices — so an undo cannot disturb the camera, the inputs or
 *     objects the user created (AC-12).
 *
 * Re-mounting goes through a per-source module cache rather than the loader: a
 * snapshot's `source` is byte-identical to the one already imported, and loading it
 * again would spend injection budget (D-6) on a module the page has resident anyway.
 *
 * **Superseding is part of the rebuild, not only of the cycle.** `runCycle` retires
 * whoever owns a state path before mounting over it, so a second "make it rain"
 * replaces the first emitter. Nothing did the same on the way back: `World.recordVerb`
 * appends, so the verb log kept both, and replaying it registered two owners of
 * `weather.rain` — which `World.register` refuses outright (it must; a shared path
 * makes every contract over it non-deterministic). The throw landed halfway through a
 * rebuild, after `restore()` had already torn the world down: an empty world, an
 * unhandled rejection, and no way back. Two utterances that touch one path is the
 * normal case after fifteen verbs, not a corner, so the rebuild now applies the same
 * rule the cycle does — later wins — and drops the verbs that end up owning nothing.
 */
import type { WorldSnapshot } from '../contracts.js';
import { PathOwnershipError, type World } from '../core/world.js';
import type { LoadedModule, ModuleLoader } from '../runtime/browser-loader.js';
import { claim, forgetAll, release } from './injected-registry.js';

type Verb = WorldSnapshot['verbs'][number];

/**
 * Re-uttering a verb supersedes it rather than stacking a second copy.
 *
 * Intent ids are a fingerprint of the utterance, so a repeat is the same id, and the
 * survivor sits where the *newest* one was said — the world is cumulative, and the
 * most recent phrasing is the one the user is looking at.
 *
 * This only catches exact repeats. Two different utterances that happen to own one
 * path (`"make it rain"`, then `"make it rain harder"`) are superseded during the
 * mount instead, where the paths are actually known.
 */
function supersede(verbs: readonly Verb[]): Verb[] {
  const byIntent = new Map<string, Verb>();
  for (const verb of verbs) {
    byIntent.delete(verb.intentId);
    byIntent.set(verb.intentId, verb);
  }
  return [...byIntent.values()];
}

/**
 * How many times one verb's mount may retire a conflicting owner before the verb is
 * abandoned. A brief is a handful of directives, so a mount that still collides after
 * this many retirements is colliding with something it is itself creating, and
 * retrying further would loop rather than converge.
 */
const RETIRE_LIMIT = 8;

export class WorldHistory {
  readonly #past: WorldSnapshot[] = [];
  readonly #modules = new Map<string, LoadedModule>();

  constructor(
    private readonly world: World,
    private readonly loader: ModuleLoader,
    /** Fired after the world changes shape, so the URL and the chrome can follow. */
    private readonly onChange: () => void,
  ) {}

  /** How many steps back are available. Drives whether the affordance is shown at all. */
  get depth(): number {
    return this.#past.length;
  }

  /**
   * The verbs currently applied, oldest first — the *effective* list.
   *
   * Deliberately not `world.snapshot().verbs`: the world's log is append-only, so
   * between an injection and the next rebuild it can hold a verb that has already
   * been superseded and owns nothing. Everything that describes the world to a human
   * (the inventory, the link) reads this instead, so what is listed is what is
   * running, and `remove(i)` indexes the same list the user clicked in.
   */
  get verbs(): readonly Verb[] {
    return supersede(this.world.snapshot().verbs);
  }

  /**
   * Takes the point a verb can be undone back to. Called with a snapshot captured
   * *before* the cycle ran and only once it is known to have injected: a rejected
   * utterance changed nothing, and an undo step that does nothing is a lie about what
   * the world remembers.
   */
  push(before: WorldSnapshot): void {
    this.#past.push(before);
  }

  async undo(): Promise<boolean> {
    const previous = this.#past.pop();
    if (previous === undefined) return false;
    await this.#apply(previous);
    return true;
  }

  /**
   * Drops one verb wherever it sits in the list. Cheap for the same reason undo is:
   * the surviving verbs carry their own sources, so the world is rebuilt from them
   * instead of unwound. Itself undoable.
   */
  async remove(index: number): Promise<boolean> {
    const current = this.world.snapshot();
    // Against the effective list, because that is the list the inventory rendered and
    // therefore the list the index came from.
    const verbs = supersede(current.verbs);
    if (index < 0 || index >= verbs.length) return false;
    this.#past.push(current);
    await this.#apply({ ...current, verbs: verbs.filter((_, i) => i !== index) });
    return true;
  }

  /**
   * Rebuilds the world from a snapshot's verbs.
   *
   * `compacted` guards the one recursion this can make: a verb that turns out to own
   * nothing is dropped from the log, and the only way to write a shorter log is
   * another `restore()`. Depth is two — the second pass has no superseded verbs left
   * to find, because the first pass already resolved every path to one owner.
   */
  async #apply(snapshot: WorldSnapshot, compacted = false): Promise<void> {
    const verbs = supersede(snapshot.verbs);
    this.world.restore({ ...snapshot, verbs });
    // The live registry is the cycle's record of who owns which path; a rebuild
    // invalidates every id in it, and a stale id would make the next injection try to
    // retire an instance that no longer exists.
    forgetAll();

    const owners = new Map<Verb, string[]>();
    for (const verb of verbs) {
      const mod = await this.#module(verb.source);
      owners.set(verb, this.#mount(mod));
    }

    // A verb whose every instance was retired by a later one is not in the world any
    // more, and leaving it in the log would put a dead row in the inventory and a
    // no-op utterance in the link. It is dropped, which needs a second rebuild
    // because the verb log can only be written by `restore()`.
    const live = new Set(this.world.instanceIds);
    const survivors = verbs.filter((v) => (owners.get(v) ?? []).some((id) => live.has(id)));
    if (!compacted && survivors.length !== verbs.length) {
      await this.#apply({ ...snapshot, verbs: survivors }, true);
      return;
    }
    this.onChange();
  }

  /**
   * Mounts one module, retiring whoever owns a path it wants.
   *
   * The paths are only known once `mount()` returns, so the collision is caught
   * rather than predicted: `World.register` throws `PathOwnershipError` naming the
   * owner, that instance is retired exactly as `runCycle` retires one, and the mount
   * is retried. A partially registered mount is unwound by the same mechanism on the
   * following attempt, since its own orphans are then the owners it collides with.
   */
  #mount(mod: LoadedModule): string[] {
    for (let attempt = 0; attempt < RETIRE_LIMIT; attempt++) {
      try {
        const ids: string[] = [];
        for (const m of mod.mount(this.world)) {
          const id = (m.instance as { id: string }).id;
          claim(m.statePath, id);
          ids.push(id);
        }
        return ids;
      } catch (err) {
        if (!(err instanceof PathOwnershipError)) throw err;
        this.world.unregister(err.ownerId);
        release(err.ownedPath);
      }
    }
    // Reported, not thrown: one verb that cannot find a home must not cost the user
    // every other verb in the world, which is what an escaping throw did here.
    console.warn(`verbo: a verb could not be re-mounted after ${RETIRE_LIMIT} retirements and was dropped`);
    return [];
  }

  async #module(source: string): Promise<LoadedModule> {
    const cached = this.#modules.get(source);
    if (cached) return cached;
    const mod = await this.loader.load(source);
    this.#modules.set(source, mod);
    return mod;
  }
}
