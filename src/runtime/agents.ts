/**
 * WS2 · the two judgement calls, behind two interfaces.
 *
 * Everything else in this workstream is deterministic: the injector, the rollback, the
 * budget. Writing three candidate modules and reading three failure diagnoses is where
 * judgement genuinely lives, so it is confined to two single-method interfaces —
 * agentic where judgement is needed, deterministic everywhere a guarantee is (the same
 * split WS4 makes for `LanguageModel`).
 *
 * Confining it that narrowly is what lets the whole cycle be tested against stubs with
 * no API key and no network. A test suite that needs the internet is not reproducible
 * for a third party running one command with their own key (R-10).
 */
import type { Candidate, Intent, Layer } from '../contracts.js';

/** Why one candidate lost, in the form the next attempt can act on. */
export interface FailureReport {
  readonly candidateId: string;
  readonly strategy: string;
  readonly failedAt: Layer | null;
  /** Actionable text, never a score — a number cannot be acted on. */
  readonly diagnosis: string;
}

/**
 * What the repair agent hands the next attempt. Text, for the same reason: the
 * generator is being told what to do differently, not given a gradient.
 */
export interface RepairGuidance {
  readonly summary: string;
  readonly instructions: readonly string[];
  /** Strategies that already failed this cycle; generating them again wastes an attempt. */
  readonly avoidStrategies: readonly string[];
}

export interface GenerationRequest {
  readonly intent: Intent;
  /** 1-based. The generator can widen or narrow its approach as attempts run out. */
  readonly attempt: number;
  readonly guidance: RepairGuidance | null;
}

export interface CandidateGenerator {
  /** Returns the parallel candidates for one attempt. Three, by D-5. */
  generate(request: GenerationRequest): Promise<readonly Candidate[]>;
}

export interface RepairRequest {
  readonly intent: Intent;
  readonly attempt: number;
  /** Every candidate's diagnosis, not one arbitrary failure (see `firstInjectable`). */
  readonly failures: readonly FailureReport[];
}

export interface RepairAgent {
  repair(request: RepairRequest): Promise<RepairGuidance>;
}

/** Candidates per attempt: three in parallel, first valid wins (D-5). */
export const CANDIDATES_PER_ATTEMPT = 3;

/**
 * A repair agent with no model in it.
 *
 * It groups the diagnoses by the layer that rejected, because the layer already says
 * what kind of mistake it was — L0 is a shape problem, L1 a budget problem, L2 a
 * behaviour problem — and a generator told "all three failed L2" has something to do
 * differently, while one told "score 0.31" does not.
 *
 * It is not a replacement for a model-backed repair agent; it is the deterministic
 * floor beneath one, so the cycle keeps its guarantees when no key is configured.
 */
export const rulesRepairAgent: RepairAgent = {
  async repair(request: RepairRequest): Promise<RepairGuidance> {
    const byLayer = new Map<string, string[]>();
    for (const f of request.failures) {
      const key = f.failedAt ?? 'unreported';
      const bucket = byLayer.get(key) ?? [];
      bucket.push(`${f.strategy}: ${f.diagnosis}`);
      byLayer.set(key, bucket);
    }
    const instructions = [...byLayer].map(
      ([layer, notes]) => `${layer} rejected ${notes.length} candidate(s) — ${LAYER_ADVICE[layer] ?? 'address the diagnosis directly'}. ${notes.join(' | ')}`,
    );
    return {
      summary:
        `attempt ${request.attempt} produced no injectable candidate for '${request.intent.utterance}'; ` +
        `${request.failures.length} diagnosis/diagnoses carried forward`,
      instructions,
      avoidStrategies: [...new Set(request.failures.map((f) => f.strategy))],
    };
  },
};

const LAYER_ADVICE: Readonly<Record<string, string>> = {
  L0: 'the module does not compile or writes outside its declared scope, so fix the shape before the behaviour',
  L1: 'the module runs but blows a frame-time, draw-call or memory budget, so reduce what it does per frame',
  L2: 'the module runs cheaply but does not satisfy its state contract, which is the authoritative oracle (D-1)',
  L3: 'only taste was unhappy, which never blocks injection — treat this as advisory (AC-11)',
  unreported: 'no layer was named, which itself is a defect in the verdict',
};
