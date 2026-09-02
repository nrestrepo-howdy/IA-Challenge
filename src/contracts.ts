/**
 * Verbo · Workstream contracts.
 *
 * This file is the only shared dependency between the five workstreams. Each one is
 * developed in its own git worktree against these signatures, in parallel, with no
 * coordination. Changing anything here is a human decision, enforced by a
 * deterministic control (`.claude/hooks/guard-protected.sh`).
 *
 *   WS1 core    → implements WorldHandle,          consumes Primitive
 *   WS2 runtime → implements Injector,             consumes Verdict, WorldHandle
 *   WS3 harness → implements Oracle[], Prober,     consumes Candidate, StateContract
 *   WS4 intent  → implements IntentCompiler,       produces Intent
 *   WS5 world   → implements Primitive[] + scene,  consumes WorldHandle
 *
 * Reference: docs/SPEC.md. Constraint and decision IDs below (R-n, D-n, AC-n) point
 * at that document.
 */

// ─── WS4 → WS2 ───────────────────────────────────────────────────────────────

/** One composition step: which primitive, imported how, parameterized with what. */
export interface PrimitiveDirective {
  readonly name: string;
  /** L0 only admits `verbo:*` specifiers listed in `allowedPrimitives`. */
  readonly importSpecifier: string;
  readonly statePath: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * The code-generation half of an intent. A brief, not a prompt: it names primitives
 * that exist and parameters that validated, so the generator composes rather than
 * invents (D-2). It crosses the WS4 -> WS2 boundary, which is why it lives here.
 */
export interface CodeBrief {
  readonly goal: string;
  readonly rationale: string;
  readonly directives: readonly PrimitiveDirective[];
  readonly steps: readonly string[];
  readonly constraints: readonly string[];
}

/**
 * What "make it rain" compiles to. Both halves are required, so code without a
 * contract is unrepresentable rather than merely discouraged (AC-16).
 */
export interface Intent {
  readonly id: string;
  readonly utterance: string;
  /** Primitives the agent may compose. Closed by design (D-2). */
  readonly allowedPrimitives: readonly string[];
  /** Permitted write scope. L0 rejects anything outside it (AC-05). */
  readonly scope: readonly string[];
  readonly contract: StateContract;
  readonly brief: CodeBrief;
}

export interface IntentCompiler {
  /** An impossible request is rejected with an explanation, never attempted silently (AC-17). */
  compile(utterance: string, world: WorldHandle): Promise<Intent | IntentRejection>;
}

export interface IntentRejection {
  readonly rejected: true;
  readonly reason: string;
  readonly suggestion: string | null;
}

// ─── WS3 · the primary oracle (D-1) ──────────────────────────────────────────

/**
 * Assertions over hidden runtime state. Modelled on StateProbe: looking at the
 * render is not enough, because external visual scoring is uncorrelated with
 * behavioural correctness (R-2).
 */
export interface StateContract {
  readonly id: string;
  readonly assertions: readonly Assertion[];
  /** Scripted actions executed between the before and after snapshots. */
  readonly actions: readonly ScriptedAction[];
  /**
   * Deliberate defects. If the contract fails to catch these, the contract itself
   * is worthless and gets regenerated (AC-10). A verifier that cannot detect
   * known-bad input is not a verifier.
   */
  readonly mutants: readonly Mutant[];
}

export interface Assertion {
  readonly id: string;
  /** Path inside window.__VERBO_STATE__ */
  readonly path: string;
  readonly kind: 'exists' | 'inRange' | 'changesOverTime' | 'boundedBy' | 'equals';
  readonly expected?: unknown;
  readonly min?: number;
  readonly max?: number;
  /** Frames between the before and after snapshots. */
  readonly window?: number;
}

export interface ScriptedAction {
  readonly kind: 'wait' | 'advanceFrames' | 'setState' | 'emit';
  readonly payload?: unknown;
}

export interface Mutant {
  readonly id: string;
  /** The four dominant failure modes catalogued by WorldCoder-Bench. */
  readonly kind: 'dropStateUpdate' | 'corruptConstant' | 'swapEventTarget' | 'nullifyDisposer';
  /** The contract MUST fail once this mutant is applied. */
  readonly mustBeCaughtBy: string;
}

// ─── WS2 → WS3 ───────────────────────────────────────────────────────────────

export interface Candidate {
  readonly id: string;
  readonly intentId: string;
  /** Candidates differ by strategy, so the three are not three samples of one thing (D-5). */
  readonly strategy: string;
  /** ES module source. Imported via blob URL under a bounded budget (R-4, D-6). */
  readonly source: string;
}

// ─── WS3 → WS2 ───────────────────────────────────────────────────────────────

export type Layer = 'L0' | 'L1' | 'L2' | 'L3';

export interface Verdict {
  readonly candidateId: string;
  readonly passed: boolean;
  /** First layer that rejected. `null` when every layer passed. */
  readonly failedAt: Layer | null;
  /** Actionable for the agent, not a score. A number cannot be acted on. */
  readonly diagnosis: string | null;
  readonly metrics: {
    readonly compileMs: number | null;
    readonly medianFrameMs: number | null;
    readonly drawCalls: number | null;
    readonly pixelDelta: number | null;
    readonly assertionsPassed: number;
    readonly assertionsTotal: number;
  };
  /** PNG from the shadow render. Visual proof of the rejection; used in the demo. */
  readonly frame: Uint8Array | null;
}

/** One oracle. Short-circuiting cascade — the ordering *is* the latency budget (R-8). */
export interface Oracle {
  readonly layer: Layer;
  readonly budgetMs: number;
  evaluate(c: Candidate, i: Intent): Promise<Omit<Verdict, 'candidateId'>>;
}

/** Runs a candidate isolated in a Worker + OffscreenCanvas (D-3, D-4). */
export interface Prober {
  /** Rejects by killing the worker on timeout. It does not catch — it kills (AC-08). */
  probe(c: Candidate, i: Intent, timeoutMs: number): Promise<ProbeResult>;
}

export interface ProbeResult {
  readonly crashed: boolean;
  readonly timedOut: boolean;
  readonly frames: readonly FrameSample[];
  /** Snapshots of __VERBO_STATE__ taken around the scripted actions. */
  readonly stateBefore: unknown;
  readonly stateAfter: unknown;
  /** Offscreen readback — the only deterministic path in headless (R-3). */
  readonly pixels: Uint8Array | null;
}

export interface FrameSample {
  readonly index: number;
  /** From timestamp-query. Quantized to 100 µs, which is ample here (R-6). */
  readonly gpuMs: number;
  readonly allBlack: boolean;
}

// ─── WS5 → WS1 ───────────────────────────────────────────────────────────────

/** A composable unit. The agent parameterizes; it does not invent (D-2). */
export interface Primitive<P = Record<string, unknown>> {
  readonly name: string;
  /** JSON Schema. L0 validates parameters against it before anything runs. */
  readonly schema: unknown;
  /** The slice of __VERBO_STATE__ this primitive declares and maintains. */
  readonly statePath: string;
  mount(world: WorldHandle, params: P): PrimitiveInstance;
}

export interface PrimitiveInstance {
  readonly id: string;
  update(dt: number): void;
  /** Mandatory. Without it the structural leak becomes unacceptable (R-4). */
  dispose(): void;
}

// ─── WS1 → everyone ──────────────────────────────────────────────────────────

export interface WorldHandle {
  readonly scene: unknown;
  readonly clock: { readonly elapsed: number };
  register(inst: PrimitiveInstance, statePath: string): void;
  unregister(id: string): void;
  /**
   * The live, mutable slice owned by one instance. Handing back the same object the
   * oracle later reads means there is no copy between a primitive's write and the
   * assertion about it -- a copy is exactly where a passing contract and a wrong
   * world would diverge.
   */
  slice(id: string): Record<string, unknown>;
  /** Records an accepted injection so `snapshot()` can replay it (AC-20). */
  recordVerb(verb: WorldSnapshot['verbs'][number]): void;
  /** The observable state. This is precisely what L2 verifies. */
  readonly state: Readonly<Record<string, unknown>>;
  /** Serialization for AC-20. */
  snapshot(): WorldSnapshot;
  restore(s: WorldSnapshot): void;
}

export interface WorldSnapshot {
  readonly version: 1;
  readonly verbs: readonly { intentId: string; utterance: string; source: string }[];
  readonly userState: unknown;
}

// ─── WS2 · hot injection ─────────────────────────────────────────────────────

export interface Injector {
  /**
   * Only ever called with a Verdict that cleared L0–L2. The signature is the
   * enforcement: there is no way to inject without a verdict, so AC-11 stops
   * depending on anyone remembering it.
   */
  inject(c: Candidate, v: Verdict): Promise<InjectResult>;
  /** Rolls back on an exception within this window (AC-13). */
  readonly rollbackWindowMs: number;
  /** Bounded per session (D-6, R-4). */
  readonly remainingBudget: number;
}

export interface InjectResult {
  readonly ok: boolean;
  readonly rolledBack: boolean;
  readonly reason: string | null;
}
