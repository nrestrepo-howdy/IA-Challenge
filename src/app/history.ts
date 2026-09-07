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
 */
import type { WorldSnapshot } from '../contracts.js';
import type { World } from '../core/world.js';
import type { LoadedModule, ModuleLoader } from '../runtime/browser-loader.js';
import { claim, forgetAll } from './injected-registry.js';

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

  /** The verbs currently applied, oldest first. */
  get verbs(): WorldSnapshot['verbs'] {
    return this.world.snapshot().verbs;
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
    if (index < 0 || index >= current.verbs.length) return false;
    this.#past.push(current);
    await this.#apply({ ...current, verbs: current.verbs.filter((_, i) => i !== index) });
    return true;
  }

  async #apply(snapshot: WorldSnapshot): Promise<void> {
    this.world.restore(snapshot);
    // The live registry is the cycle's record of who owns which path; a rebuild
    // invalidates every id in it, and a stale id would make the next injection try to
    // retire an instance that no longer exists.
    forgetAll();
    for (const verb of snapshot.verbs) {
      const mod = await this.#module(verb.source);
      for (const m of mod.mount(this.world)) {
        claim(m.statePath, (m.instance as { id: string }).id);
      }
    }
    this.onChange();
  }

  async #module(source: string): Promise<LoadedModule> {
    const cached = this.#modules.get(source);
    if (cached) return cached;
    const mod = await this.loader.load(source);
    this.#modules.set(source, mod);
    return mod;
  }
}
