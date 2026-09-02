/**
 * WS2 · hot injection into the running world.
 *
 * Three guarantees live here, and each one is a mechanism rather than a rule someone
 * has to remember:
 *
 *   1. **Nothing uninjectable gets in.** The verdict is checked with `isInjectable()`
 *      from the harness — the single place in the system that answers that question.
 *      This module does not restate the rule, because a rule stated twice is a rule
 *      that will eventually disagree with itself (AC-11).
 *
 *   2. **A throw inside the rollback window undoes the injection.** Every instance is
 *      registered wrapped in a guard, so an injected primitive cannot reach the frame
 *      loop unwatched. Within the window a throw rolls the world back to the snapshot
 *      taken before the injection; after it, the throw propagates like any other bug
 *      and the host deals with it (AC-13).
 *
 *   3. **Injections are bounded.** Blob-URL modules can never be released (R-4), so
 *      the session budget is the only honest lever: past it, injection is refused with
 *      a reason rather than accepted into a leak nobody is counting (D-6, AC-15).
 *
 * What the budget does *not* bound is the live registry — that is bounded separately,
 * by superseding. Re-injecting an intent retires the instances the previous injection
 * mounted, so twenty injections of "make it rain" leave one emitter running and
 * nineteen disposed, not twenty ticking primitives fighting over one state slice.
 */
import type {
  Candidate,
  InjectResult,
  Injector,
  Intent,
  PrimitiveInstance,
  Verdict,
  WorldHandle,
  WorldSnapshot,
} from '../contracts.js';
import { isInjectable } from '../harness/cascade.js';
import type { LoadedModule, ModuleLoader, MountedPrimitive } from './loader.js';

/**
 * 3 s, from AC-13. Long enough for a fault that only shows up once the world has been
 * ticking for a while, short enough that the user is still holding the utterance in
 * their head when it disappears.
 */
export const ROLLBACK_WINDOW_MS = 3_000;

/**
 * Injections allowed per session (D-6).
 *
 * A number, not a policy: R-4 makes every injected module permanently resident, so
 * "unlimited" would mean an unbounded leak in a page the user is expected to keep
 * open. It sits above the 20 of AC-15 so that criterion measures the budget holding,
 * not the budget being exactly the test.
 */
export const DEFAULT_INJECTION_BUDGET = 32;

/** What a rollback did, in enough detail for the demo and for a repair agent. */
export interface RollbackEvent {
  readonly intentId: string;
  readonly candidateId: string;
  /** Actionable text, not a code: a repair agent has to act on this. */
  readonly reason: string;
  /** Milliseconds between the injection and the fault. Always ≤ rollbackWindowMs. */
  readonly elapsedMs: number;
}

export interface HotInjectorOptions {
  readonly world: WorldHandle;
  readonly loader: ModuleLoader;
  readonly budget?: number;
  readonly rollbackWindowMs?: number;
  /** Injected so the window is testable without waiting three real seconds. */
  readonly now?: () => number;
  readonly onRollback?: (event: RollbackEvent) => void;
}

interface LiveInjection {
  readonly intentId: string;
  readonly candidateId: string;
  /** Retained so a rollback can re-mount the survivors without re-loading them (R-4). */
  readonly module: LoadedModule;
  readonly injectedAt: number;
  instanceIds: string[];
  armed: boolean;
}

/**
 * Wraps an injected instance so a throw is a rollback signal rather than a stalled
 * world. The id is the inner id: `world.slice(id)` must keep working, so the guard has
 * to be invisible to everything except the error path.
 */
class GuardedInstance implements PrimitiveInstance {
  constructor(
    private readonly inner: PrimitiveInstance,
    private readonly onFault: (err: unknown) => void,
    private readonly isArmed: () => boolean,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  update(dt: number): void {
    try {
      this.inner.update(dt);
    } catch (err) {
      // Past the window the injection is the world's own code: a bug the host sees,
      // not something to silently undo three minutes into a session (AC-13).
      if (!this.isArmed()) throw err;
      this.onFault(err);
    }
  }

  dispose(): void {
    this.inner.dispose();
  }
}

export class HotInjector implements Injector {
  readonly rollbackWindowMs: number;

  readonly #world: WorldHandle;
  readonly #loader: ModuleLoader;
  readonly #budget: number;
  readonly #now: () => number;
  readonly #onRollback: (event: RollbackEvent) => void;

  /** Insertion order is replay order: a rollback must rebuild the world as it was. */
  readonly #live = new Map<string, LiveInjection>();
  /** Utterances, which `inject(c, v)` cannot otherwise know. See `remember()`. */
  readonly #intents = new Map<string, Intent>();
  #spent = 0;
  #disposed = 0;
  #pending: Promise<void> = Promise.resolve();
  #rollbacks: RollbackEvent[] = [];

  constructor(options: HotInjectorOptions) {
    this.#world = options.world;
    this.#loader = options.loader;
    this.#budget = options.budget ?? DEFAULT_INJECTION_BUDGET;
    this.rollbackWindowMs = options.rollbackWindowMs ?? ROLLBACK_WINDOW_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#onRollback = options.onRollback ?? (() => {});
  }

  /** Injections left this session. Zero is a refusal, not a slowdown (D-6). */
  get remainingBudget(): number {
    return Math.max(0, this.#budget - this.#spent);
  }

  /** Instances this injector has disposed. The measurable half of R-4's only lever. */
  get disposedCount(): number {
    return this.#disposed;
  }

  /** Injections currently mounted. Bounded by distinct intents, not by injection count. */
  get liveCount(): number {
    return this.#live.size;
  }

  get rollbacks(): readonly RollbackEvent[] {
    return this.#rollbacks;
  }

  /**
   * Tells the injector the utterance behind an intent id.
   *
   * `inject(c, v)` carries neither the intent nor the utterance, but `recordVerb()`
   * needs one for the world to replay (AC-20). Rather than inventing a placeholder,
   * the orchestrator hands the intent over before injecting; an unknown id falls back
   * to the id itself, which at least replays.
   */
  remember(intent: Intent): void {
    this.#intents.set(intent.id, intent);
  }

  /**
   * Resolves once any rollback triggered from a frame has finished rebuilding the
   * world. Rolling back has to re-mount the surviving injections, and mounting is
   * allowed to be async — so the fault is handled synchronously (the faulting
   * primitive stops ticking immediately) and the rebuild settles here.
   */
  async settle(): Promise<void> {
    await this.#pending;
  }

  async inject(candidate: Candidate, verdict: Verdict): Promise<InjectResult> {
    // The one authority on this question lives in the harness (AC-11).
    if (!isInjectable(verdict)) {
      return {
        ok: false,
        rolledBack: false,
        reason:
          `candidate '${candidate.id}' failed at ${verdict.failedAt ?? 'an unnamed layer'} and is ` +
          `not injectable: ${verdict.diagnosis ?? 'no diagnosis supplied'}`,
      };
    }
    if (this.remainingBudget <= 0) {
      return {
        ok: false,
        rolledBack: false,
        reason:
          `injection budget exhausted: ${this.#budget} injections used this session. ES modules ` +
          'imported via blob URL can never be released (R-4), so the budget is bounded rather ' +
          'than pretended away (D-6). Reload the world to start a new session.',
      };
    }

    let module: LoadedModule;
    try {
      module = await this.#loader.load(candidate);
    } catch (err) {
      return { ok: false, rolledBack: false, reason: `module failed to load: ${describe(err)}` };
    }

    const before = this.#world.snapshot();
    // Superseding first: the previous injection for this intent owns the state path the
    // new one is about to declare, and the world refuses overlapping owners outright.
    // Its entry stays in `#live` with no instances, so if the new one fails to mount the
    // rollback puts the old one back — in its original tick position, since overwriting
    // a Map key keeps the key where it was.
    this.#retire(candidate.intentId);

    const injection: LiveInjection = {
      intentId: candidate.intentId,
      candidateId: candidate.id,
      module,
      injectedAt: this.#now(),
      instanceIds: [],
      armed: true,
    };

    try {
      injection.instanceIds = await this.#mount(injection, module);
    } catch (err) {
      // A mount that throws never reaches a frame, but it may have registered half its
      // primitives or written state before failing — so it is rolled back exactly like
      // a fault inside the window (AC-13).
      await this.#restore(before);
      const reason = `injection threw while mounting: ${describe(err)}`;
      this.#note({ intentId: candidate.intentId, candidateId: candidate.id, reason, elapsedMs: 0 });
      return { ok: false, rolledBack: true, reason };
    }

    this.#spent += 1;
    this.#live.set(candidate.intentId, injection);
    this.#world.recordVerb({
      intentId: candidate.intentId,
      utterance: this.#intents.get(candidate.intentId)?.utterance ?? candidate.intentId,
      source: candidate.source,
    });
    return { ok: true, rolledBack: false, reason: null };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /** Mounts a module and registers every instance guarded. Returns the registered ids. */
  async #mount(injection: LiveInjection, module: LoadedModule): Promise<string[]> {
    const mounted: readonly MountedPrimitive[] = await module.mount(this.#world);
    const ids: string[] = [];
    try {
      for (const unit of mounted) {
        const guarded = new GuardedInstance(
          unit.instance,
          (err) => this.#fault(injection, err),
          () => injection.armed && this.#now() - injection.injectedAt <= this.rollbackWindowMs,
        );
        this.#world.register(guarded, unit.statePath);
        ids.push(guarded.id);
      }
    } catch (err) {
      // Partially registered is the worst state to leave a world in; unwind what landed
      // before letting the caller roll the rest back.
      for (const id of ids) this.#unregister(id);
      throw err;
    }
    return ids;
  }

  /**
   * Handles a throw from inside the rollback window.
   *
   * Synchronous first: disarm and unregister the faulting injection so the broken
   * primitive stops ticking in this very frame. The state rebuild is what needs to be
   * awaited, and `settle()` is where callers wait for it.
   */
  #fault(injection: LiveInjection, err: unknown): void {
    if (!injection.armed) return;
    injection.armed = false;
    const elapsedMs = this.#now() - injection.injectedAt;
    const before = this.#snapshotWithout(injection);

    for (const id of injection.instanceIds) this.#unregister(id);
    injection.instanceIds = [];
    this.#live.delete(injection.intentId);

    const reason =
      `injection threw ${elapsedMs} ms after mounting, inside the ${this.rollbackWindowMs} ms ` +
      `rollback window: ${describe(err)}`;
    this.#pending = this.#pending
      .then(() => this.#restore(before))
      .then(() => {
        this.#note({
          intentId: injection.intentId,
          candidateId: injection.candidateId,
          reason,
          elapsedMs,
        });
      });
  }

  /**
   * The world as it was before this injection: its own verb dropped, everything the
   * user did since kept.
   *
   * Snapshotting at fault time rather than reusing the snapshot from `inject()` is
   * deliberate — AC-12 says an injection must leave user state alone, and so must
   * undoing one. Rolling back to a three-second-old copy of the camera would be a
   * second bug wearing the first one's clothes.
   */
  #snapshotWithout(injection: LiveInjection): WorldSnapshot {
    const now = this.#world.snapshot();
    const verbs = [...now.verbs];
    for (let i = verbs.length - 1; i >= 0; i -= 1) {
      if (verbs[i]?.intentId === injection.intentId) {
        verbs.splice(i, 1);
        break;
      }
    }
    return { version: 1, verbs, userState: now.userState };
  }

  /**
   * Restores state and rebuilds the injections that survive.
   *
   * `WorldHandle.restore()` deliberately holds no code loader — replaying verbs is this
   * workstream's job — so it tears every instance down and this re-mounts the survivors
   * from their retained modules. Retained, not re-loaded: a second blob URL for a module
   * already resident would spend budget to import code the page can never free twice
   * over (R-4).
   */
  async #restore(target: WorldSnapshot): Promise<void> {
    const survivors = [...this.#live.values()];
    this.#live.clear();
    // restore() disposes everything registered, survivors included; count those.
    this.#disposed += survivors.reduce((n, s) => n + s.instanceIds.length, 0);
    this.#world.restore(target);

    for (const survivor of survivors) {
      survivor.armed = false; // proven code, already past its own window
      survivor.instanceIds = await this.#mount(survivor, survivor.module);
      this.#live.set(survivor.intentId, survivor);
    }
  }

  /** Supersedes an intent's previous injection. This is the registry's only bound. */
  #retire(intentId: string): void {
    const previous = this.#live.get(intentId);
    if (previous === undefined) return;
    previous.armed = false;
    for (const id of previous.instanceIds) this.#unregister(id);
    previous.instanceIds = [];
  }

  /** `unregister()` disposes — the only cleanup that exists, given R-4. */
  #unregister(id: string): void {
    this.#world.unregister(id);
    this.#disposed += 1;
  }

  #note(event: RollbackEvent): void {
    this.#rollbacks.push(event);
    this.#onRollback(event);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
