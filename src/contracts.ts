/**
 * Verbo · Contratos entre workstreams.
 *
 * Este archivo es la única dependencia compartida entre los cinco flujos de
 * trabajo. Cada uno se desarrolla en su propio worktree contra estas firmas,
 * en paralelo y sin coordinación. Cambiar algo aquí es una decisión humana
 * (control determinista en guard-protected.sh).
 *
 * WS1 core    → implementa WorldHandle, consume Primitive
 * WS2 runtime → implementa Injector, consume Verdict y WorldHandle
 * WS3 harness → implementa Oracle[] y Prober, consume Candidate y StateContract
 * WS4 intent  → implementa IntentCompiler, produce Intent
 * WS5 world   → implementa Primitive[] y la escena base
 */

// ─── WS4 → WS2 ───────────────────────────────────────────────────────────────

/** Lo que sale de "que llueva": nunca código sin contrato (AC-16). */
export interface Intent {
  readonly id: string;
  readonly utterance: string;
  /** Primitivas que el agente puede componer. Cerrado por diseño (D-2). */
  readonly allowedPrimitives: readonly string[];
  /** Ámbito de escritura permitido. L0 rechaza cualquier cosa fuera (AC-05). */
  readonly scope: readonly string[];
  readonly contract: StateContract;
}

// ─── WS3: el oráculo principal (D-1) ─────────────────────────────────────────

/** Aserciones sobre estado oculto. StateProbe: la vista no basta (R-2). */
export interface StateContract {
  readonly id: string;
  readonly assertions: readonly Assertion[];
  /** Acciones guionizadas ejecutadas entre snapshots. */
  readonly actions: readonly ScriptedAction[];
  /**
   * Defectos deliberados. Si el contrato no los detecta, no vale (AC-10).
   * Endurecimiento por mutación, como en StateProbe.
   */
  readonly mutants: readonly Mutant[];
}

export interface Assertion {
  readonly id: string;
  /** Ruta dentro de window.__VERBO_STATE__ */
  readonly path: string;
  readonly kind: 'exists' | 'inRange' | 'changesOverTime' | 'boundedBy' | 'equals';
  readonly expected?: unknown;
  readonly min?: number;
  readonly max?: number;
  /** Frames entre el snapshot previo y el posterior. */
  readonly window?: number;
}

export interface ScriptedAction {
  readonly kind: 'wait' | 'advanceFrames' | 'setState' | 'emit';
  readonly payload?: unknown;
}

export interface Mutant {
  readonly id: string;
  readonly kind: 'dropStateUpdate' | 'corruptConstant' | 'swapEventTarget' | 'nullifyDisposer';
  /** El contrato DEBE fallar con este mutante aplicado. */
  readonly mustBeCaughtBy: string;
}

// ─── WS2 → WS3 ───────────────────────────────────────────────────────────────

export interface Candidate {
  readonly id: string;
  readonly intentId: string;
  readonly strategy: string;
  /** Módulo ES como texto. Se importa vía blob URL; presupuesto acotado (R-4). */
  readonly source: string;
}

// ─── WS3 → WS2 ───────────────────────────────────────────────────────────────

export type Layer = 'L0' | 'L1' | 'L2' | 'L3';

export interface Verdict {
  readonly candidateId: string;
  readonly passed: boolean;
  /** Primera capa que rechazó. null si pasó todas. */
  readonly failedAt: Layer | null;
  /** Accionable para el agente, no un número (ReLook). */
  readonly diagnosis: string | null;
  readonly metrics: {
    readonly compileMs: number | null;
    readonly medianFrameMs: number | null;
    readonly drawCalls: number | null;
    readonly pixelDelta: number | null;
    readonly assertionsPassed: number;
    readonly assertionsTotal: number;
  };
  /** PNG del render sombra. Prueba visual del rechazo, va en el demo. */
  readonly frame: Uint8Array | null;
}

/** Un oráculo. Cascada con cortocircuito: el orden es el presupuesto (R-8). */
export interface Oracle {
  readonly layer: Layer;
  readonly budgetMs: number;
  evaluate(c: Candidate, i: Intent): Promise<Omit<Verdict, 'candidateId'>>;
}

/** Ejecuta el candidato aislado en Worker + OffscreenCanvas (D-3, D-4). */
export interface Prober {
  /** Rechaza por timeout matando el worker; no atrapa, mata (AC-08). */
  probe(c: Candidate, i: Intent, timeoutMs: number): Promise<ProbeResult>;
}

export interface ProbeResult {
  readonly crashed: boolean;
  readonly timedOut: boolean;
  readonly frames: readonly FrameSample[];
  /** Snapshots de __VERBO_STATE__ antes y después de las acciones. */
  readonly stateBefore: unknown;
  readonly stateAfter: unknown;
  /** Readback offscreen: única vía determinista en headless (R-3). */
  readonly pixels: Uint8Array | null;
}

export interface FrameSample {
  readonly index: number;
  /** timestamp-query, cuantizado a 100 µs; suficiente (R-6). */
  readonly gpuMs: number;
  readonly allBlack: boolean;
}

// ─── WS5 → WS1 ───────────────────────────────────────────────────────────────

/** Unidad componible. El agente parametriza; no inventa (D-2). */
export interface Primitive<P = Record<string, unknown>> {
  readonly name: string;
  readonly schema: unknown;
  /** Porción de __VERBO_STATE__ que esta primitiva declara y mantiene. */
  readonly statePath: string;
  mount(world: WorldHandle, params: P): PrimitiveInstance;
}

export interface PrimitiveInstance {
  readonly id: string;
  update(dt: number): void;
  /** Obligatorio. Sin esto la fuga estructural se vuelve inaceptable (R-4). */
  dispose(): void;
}

// ─── WS1 → todos ─────────────────────────────────────────────────────────────

export interface WorldHandle {
  readonly scene: unknown;
  readonly clock: { readonly elapsed: number };
  register(inst: PrimitiveInstance, statePath: string): void;
  unregister(id: string): void;
  /** El estado observable. Es lo que L2 verifica. */
  readonly state: Readonly<Record<string, unknown>>;
  /** Serialización para AC-20. */
  snapshot(): WorldSnapshot;
  restore(s: WorldSnapshot): void;
}

export interface WorldSnapshot {
  readonly version: 1;
  readonly verbs: readonly { intentId: string; utterance: string; source: string }[];
  readonly userState: unknown;
}

// ─── WS2: inyección en caliente ──────────────────────────────────────────────

export interface Injector {
  /** Solo se llama con un Verdict que pasó L0–L2. L3 nunca basta (AC-11). */
  inject(c: Candidate, v: Verdict): Promise<InjectResult>;
  /** Revierte si hay excepción en los primeros 3 s (AC-13). */
  readonly rollbackWindowMs: number;
  /** Presupuesto acotado por sesión (D-6, R-4). */
  readonly remainingBudget: number;
}

export interface InjectResult {
  readonly ok: boolean;
  readonly rolledBack: boolean;
  readonly reason: string | null;
}
