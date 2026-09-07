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
 * One re-parameterisation: this directive's parameter takes this value next time.
 *
 * D-2 is what bounds the shape of this type. The agent composes catalogue primitives
 * and never invents, so a repair cannot be a patch, a diff, or a line of source — the
 * only levers a repair has are *which* primitives compose in *what order* and *with
 * what numbers*. Everything a repair agent is allowed to say fits in here and in
 * `preferStrategies`, which is why free-form code is not merely discouraged: there is
 * nowhere to put it.
 */
export interface ParamAdjustment {
  /** A directive name already present in the brief. New primitives are not a repair. */
  readonly primitive: string;
  readonly param: string;
  readonly value: number | readonly number[];
  /** Why this number, in the same actionable prose a diagnosis is written in. */
  readonly reason: string;
}

/**
 * What the repair agent hands the next attempt.
 *
 * Prose *and* levers. The prose is what a human reads in the log; `params` and
 * `preferStrategies` are what actually reach the generator, because an instruction
 * nothing consumes is not a repair — it is a note. Everything here is applied by
 * `applyGuidance()` in generate.ts, which is the single place that decides what a
 * repair is permitted to change.
 */
export interface RepairGuidance {
  readonly summary: string;
  readonly instructions: readonly string[];
  /** Strategies that already failed this cycle; generating them again wastes an attempt. */
  readonly avoidStrategies: readonly string[];
  /** The re-parameterisation half of a repair. Empty when no number is worth moving. */
  readonly params: readonly ParamAdjustment[];
  /**
   * The re-composition half. Strategy names to put first next attempt — order decides
   * which candidate wins the race in `firstInjectable`, and it decides mount order,
   * which is itself a behavioural difference (see `reversedStrategy`).
   */
  readonly preferStrategies: readonly string[];
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

    const layer = dominantLayer(request.failures);
    const factor = SCALE[layer] ** request.attempt;
    const failed = [...new Set(request.failures.map((f) => f.strategy))];
    return {
      summary:
        `attempt ${request.attempt} produced no injectable candidate for '${request.intent.utterance}'; ` +
        `${request.failures.length} diagnosis/diagnoses carried forward`,
      instructions,
      avoidStrategies: failed,
      params: adjustments(request, layer, factor),
      // Rotating rather than excluding: three strategies is the whole supply (D-5), so
      // dropping the ones that failed would leave the next attempt with nothing to
      // generate. What changes is which composition leads — and with `reversedStrategy`
      // in the set, that is a change in mount order, not a reshuffle of identical work.
      preferStrategies: rotate(failed, request.attempt),
    };
  },
};

/** Empty in, empty out: an attempt with no failures has nothing to reorder. */
function rotate(names: readonly string[], by: number): readonly string[] {
  if (names.length === 0) return names;
  return names.map((_, i) => names[(i + by) % names.length] as string);
}

/**
 * The cheapest layer that rejected, ties broken toward the front of the cascade.
 *
 * The cascade short-circuits, so a candidate that failed L0 was never asked about its
 * behaviour: its L2 verdict does not exist and cannot be inferred. Repairing the
 * earliest complaint first is the same ordering the oracles already impose — fix the
 * shape before the behaviour.
 */
function dominantLayer(failures: readonly FailureReport[]): RepairLayer {
  const order: readonly RepairLayer[] = ['L0', 'L1', 'L2', 'L3', 'unreported'];
  const seen = new Set<RepairLayer>(failures.map((f) => f.failedAt ?? 'unreported'));
  return order.find((l) => seen.has(l)) ?? 'unreported';
}

/** A layer, plus the case of a verdict that named none — itself a defect worth a bucket. */
type RepairLayer = Layer | 'unreported';

/**
 * Which way a number moves, per layer.
 *
 * L1 is a budget complaint and the only one whose direction is unambiguous: less work
 * per frame. Everywhere else the deterministic floor is guessing at direction, and it
 * guesses *up*, because the dominant real failure behind R-1 is "present but inert" —
 * a primitive that mounted and then did not move enough for an `animated` assertion to
 * witness it.
 *
 * The guarantee this rule actually makes is the weaker one, and it is the one that
 * matters here: attempt N+1 is not attempt N. A model-backed `ClaudeRepairAgent`
 * reasons about direction from the diagnosis text; this floor only promises that the
 * retry is a different program.
 */
const SCALE: Readonly<Record<RepairLayer, number>> = {
  L0: 1.5, L1: 0.5, L2: 1.5, L3: 1.5, unreported: 1.5,
};

function adjustments(
  request: RepairRequest,
  layer: RepairLayer,
  factor: number,
): readonly ParamAdjustment[] {
  const out: ParamAdjustment[] = [];
  const why = `${layer} rejected every candidate at attempt ${request.attempt}, so this value moves by ×${factor}`;
  for (const d of request.intent.brief.directives) {
    for (const [param, value] of Object.entries(d.params)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        // A parameter pinned at zero cannot be scaled off zero, and a zero-count
        // emitter is exactly the inert case above, so it gets a floor instead.
        const moved = value === 0 ? (factor > 1 ? 1 : 0) : value * factor;
        if (moved !== value) out.push({ primitive: d.name, param, value: moved, reason: why });
      } else if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
        const moved = (value as number[]).map((v) => v * factor);
        if (moved.some((v, i) => v !== value[i])) {
          out.push({ primitive: d.name, param, value: moved, reason: why });
        }
      }
    }
  }
  return out;
}

const LAYER_ADVICE: Readonly<Record<string, string>> = {
  L0: 'the module does not compile or writes outside its declared scope, so fix the shape before the behaviour',
  L1: 'the module runs but blows a frame-time, draw-call or memory budget, so reduce what it does per frame',
  L2: 'the module runs cheaply but does not satisfy its state contract, which is the authoritative oracle (D-1)',
  L3: 'only taste was unhappy, which never blocks injection — treat this as advisory (AC-11)',
  unreported: 'no layer was named, which itself is a defect in the verdict',
};
