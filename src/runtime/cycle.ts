/**
 * WS2 · the cycle: intent in, injected verb or an explained report out.
 *
 * One attempt is three candidates verified in parallel, first injectable one wins
 * (D-5). Parallelism here buys latency against the 40 s budget (R-8); it is not three
 * samples of one thing, because the candidates differ by strategy.
 *
 * The loop is bounded at `MAX_ATTEMPTS`, which is the whole of AC-19: with every
 * candidate failing, the cycle retries a fixed number of times and then reports what
 * went wrong. "Never hangs" is a property of the shape — a counted `for`, no condition
 * to satisfy, no recursion — rather than a timeout someone has to get right. Runaway
 * candidate *code* is a separate problem, and it is already solved one layer down: the
 * Prober kills its worker instead of catching it (D-3, AC-08).
 *
 * Failure is not a dead end either. Every candidate's diagnosis from every attempt
 * reaches the repair agent, so the next attempt is informed by three failures rather
 * than by whichever one happened to resolve first.
 */
import type { Candidate, Intent, InjectResult, Injector, Oracle, Verdict } from '../contracts.js';
import { firstInjectable, runCascade, type CascadeResult } from '../harness/cascade.js';
import {
  CANDIDATES_PER_ATTEMPT,
  rulesRepairAgent,
  type CandidateGenerator,
  type FailureReport,
  type RepairAgent,
  type RepairGuidance,
} from './agents.js';

/**
 * Attempts per utterance, from AC-19.
 *
 * Counted as total attempts rather than "one try plus three retries": three attempts of
 * three candidates is nine verified modules, and R-1 puts the per-candidate hit rate
 * near 28%, so a fourth attempt buys a few percent for a quarter of the latency budget.
 */
export const MAX_ATTEMPTS = 3;

/**
 * `Injector` with the one thing its signature cannot carry.
 *
 * `inject(c, v)` receives neither the intent nor the utterance, but a recorded verb
 * needs the utterance to be replayable (AC-20). `remember()` is optional so any
 * conforming `Injector` still works — it simply records the intent id instead.
 */
export interface IntentAwareInjector extends Injector {
  remember?(intent: Intent): void;
}

export interface CycleDeps {
  readonly generator: CandidateGenerator;
  readonly oracles: readonly Oracle[];
  readonly injector: IntentAwareInjector;
  readonly repair?: RepairAgent;
  readonly now?: () => number;
}

export interface AttemptRecord {
  readonly attempt: number;
  readonly candidateCount: number;
  readonly failures: readonly FailureReport[];
  readonly guidance: RepairGuidance | null;
}

export type CycleResult =
  | {
      readonly ok: true;
      readonly attempts: number;
      readonly candidate: Candidate;
      readonly verdict: Verdict;
      readonly injection: InjectResult;
      readonly history: readonly AttemptRecord[];
      readonly elapsedMs: number;
    }
  | {
      readonly ok: false;
      readonly attempts: number;
      /** Explained, never silent (the same standard AC-17 sets for the compiler). */
      readonly report: string;
      readonly failures: readonly FailureReport[];
      readonly guidance: RepairGuidance | null;
      readonly history: readonly AttemptRecord[];
      readonly elapsedMs: number;
    };

export async function runCycle(intent: Intent, deps: CycleDeps): Promise<CycleResult> {
  const repair = deps.repair ?? rulesRepairAgent;
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const history: AttemptRecord[] = [];
  const allFailures: FailureReport[] = [];
  let guidance: RepairGuidance | null = null;
  let attempts = 0;

  deps.injector.remember?.(intent);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    const candidates = await deps.generator.generate({ intent, attempt, guidance });
    const failures: FailureReport[] = [];

    if (candidates.length === 0) {
      failures.push({
        candidateId: `attempt-${attempt}`,
        strategy: 'none',
        failedAt: null,
        diagnosis: 'the generator produced no candidates, so there was nothing to verify',
      });
    }

    const results = await firstInjectable(
      candidates.map((c) => runCascade(deps.oracles, c, intent)),
    );

    if (results.winner !== null) {
      const winner = byId(candidates, results.winner.verdict.candidateId);
      // The injector re-checks injectability itself; passing a winner here is not what
      // makes it safe, `isInjectable()` is (AC-11).
      const injection = await deps.injector.inject(winner, results.winner.verdict);
      if (injection.ok) {
        return {
          ok: true,
          attempts,
          candidate: winner,
          verdict: results.winner.verdict,
          injection,
          history,
          elapsedMs: now() - started,
        };
      }
      // A verdict can pass every oracle and still not survive contact with the live
      // world — a rollback inside the window, or an exhausted budget. That is a failure
      // of this attempt, and its reason is as actionable as any oracle diagnosis.
      failures.push({
        candidateId: winner.id,
        strategy: winner.strategy,
        failedAt: null,
        diagnosis: injection.reason ?? 'injection failed without a reason',
      });
    }

    for (const result of results.all) {
      if (result === results.winner) continue;
      failures.push(toFailure(result, candidates));
    }

    allFailures.push(...failures);
    guidance = await repair.repair({ intent, attempt, failures });
    history.push({ attempt, candidateCount: candidates.length, failures, guidance });
  }

  return {
    ok: false,
    attempts,
    report: report(intent, history),
    failures: allFailures,
    guidance,
    history,
    elapsedMs: now() - started,
  };
}

function toFailure(result: CascadeResult, candidates: readonly Candidate[]): FailureReport {
  const { verdict } = result;
  const candidate = candidates.find((c) => c.id === verdict.candidateId);
  return {
    candidateId: verdict.candidateId,
    strategy: candidate?.strategy ?? 'unknown',
    failedAt: verdict.failedAt,
    diagnosis:
      verdict.diagnosis ??
      `rejected at ${verdict.failedAt ?? 'no layer'} with no diagnosis, which is itself a defect`,
  };
}

function byId(candidates: readonly Candidate[], id: string): Candidate {
  const found = candidates.find((c) => c.id === id);
  if (found === undefined) {
    throw new Error(`cascade returned a verdict for unknown candidate '${id}'`);
  }
  return found;
}

/**
 * The thing the user sees when it did not work.
 *
 * It names every layer that rejected and every diagnosis, because "I could not do that"
 * teaches nobody anything — not the user, and not the next attempt.
 */
function report(intent: Intent, history: readonly AttemptRecord[]): string {
  const lines = [
    `'${intent.utterance}' was not injected after ${history.length} attempt(s) of up to ` +
      `${CANDIDATES_PER_ATTEMPT} candidates each (AC-19: the cycle is bounded, not open-ended).`,
  ];
  for (const record of history) {
    lines.push(`attempt ${record.attempt}:`);
    for (const f of record.failures) {
      lines.push(`  - ${f.candidateId} (${f.strategy}) failed at ${f.failedAt ?? 'injection'}: ${f.diagnosis}`);
    }
  }
  const last = history[history.length - 1]?.guidance;
  if (last !== undefined && last !== null) {
    lines.push(`repair guidance: ${last.summary}`);
    for (const instruction of last.instructions) lines.push(`  - ${instruction}`);
  }
  return lines.join('\n');
}
