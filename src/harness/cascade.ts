/**
 * The oracle cascade, and the gate in front of injection.
 *
 * Two responsibilities, deliberately kept in one place because they are the same
 * guarantee seen from both sides:
 *
 *   1. Run the four layers cheapest-first, short-circuiting on the first rejection.
 *      The ordering IS the latency budget (R-8): L0 and L1 are deterministic and cost
 *      milliseconds, and they kill most candidates before a single token is spent on
 *      the visual critic.
 *
 *   2. Decide what may be injected. L3 is advisory. A candidate that failed L0, L1 or
 *      L2 is not injectable no matter how enthusiastic the visual critic was (AC-11).
 *      WorldCoder-Bench reports failures dominated by state-schema drift rather than by
 *      defective output, so "the vision model liked it" is not evidence of anything.
 */
import type { Candidate, Intent, Layer, Oracle, Verdict } from '../contracts.js';

/** Layers whose approval is required. L3 is deliberately absent. */
export const AUTHORITATIVE_LAYERS: readonly Layer[] = ['L0', 'L1', 'L2'] as const;

export const LAYER_ORDER: readonly Layer[] = ['L0', 'L1', 'L2', 'L3'] as const;

/**
 * The single predicate that gates injection (AC-11).
 *
 * Expressed as one function so there is exactly one place in the system that can
 * answer "may this be injected?", rather than the rule being restated -- and
 * eventually contradicted -- at each call site.
 */
export function isInjectable(v: Verdict): boolean {
  if (v.failedAt === null) return v.passed;
  // Failing L3 alone is a matter of taste, not correctness: it does not block.
  return !AUTHORITATIVE_LAYERS.includes(v.failedAt);
}

export interface CascadeResult {
  readonly verdict: Verdict;
  /** Layers actually executed. Short-circuiting means this is often just ['L0']. */
  readonly executed: readonly Layer[];
  readonly totalMs: number;
}

/**
 * Runs the oracles in order, stopping at the first authoritative rejection.
 *
 * L3 still runs after an L3-only concern, because its diagnosis feeds the repair
 * agent even when it does not block. A rejection nobody can act on is wasted work.
 */
export async function runCascade(
  oracles: readonly Oracle[],
  candidate: Candidate,
  intent: Intent,
  now: () => number = () => performance.now(),
): Promise<CascadeResult> {
  const ordered = [...oracles].sort(
    (a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer),
  );

  const started = now();
  const executed: Layer[] = [];
  let last: Omit<Verdict, 'candidateId'> | null = null;

  for (const oracle of ordered) {
    executed.push(oracle.layer);
    const result = await oracle.evaluate(candidate, intent);
    last = result;
    if (!result.passed && AUTHORITATIVE_LAYERS.includes(oracle.layer)) {
      // Short-circuit: nothing downstream can rescue this, and the layers below are
      // the expensive ones.
      return {
        verdict: { ...result, candidateId: candidate.id, failedAt: oracle.layer },
        executed,
        totalMs: now() - started,
      };
    }
  }

  if (last === null) {
    throw new Error('runCascade: no oracles supplied; a candidate cannot pass by default');
  }
  return { verdict: { ...last, candidateId: candidate.id }, executed, totalMs: now() - started };
}

/**
 * Races candidates, resolving with the first injectable one (D-5).
 *
 * Parallelism here buys latency, which is a stated product requirement -- not an
 * excuse to say the word "parallel". If every candidate fails, all verdicts are
 * returned so the repair agent can see the full picture rather than one arbitrary
 * failure.
 */
export async function firstInjectable(
  runs: readonly Promise<CascadeResult>[],
): Promise<{ winner: CascadeResult | null; all: readonly CascadeResult[] }> {
  const all = await Promise.all(runs);
  return { winner: all.find((r) => isInjectable(r.verdict)) ?? null, all };
}
