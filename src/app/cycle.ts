/**
 * The live cycle: utterance in, world changed out.
 *
 * Joins the five workstreams for the first time against a real renderer. Every piece
 * here already existed and was verified in isolation; this file only wires them, which
 * is the payoff of freezing the contracts before any of them were written.
 *
 *   utterance -> IntentCompiler -> 3 candidates -> cascade (L0, L1, L2) -> injection
 *
 * **Shadow, honestly.** A candidate is probed against a *scratch* `World` -- its own
 * state tree, its own clock, never the live one -- so a candidate that corrupts state
 * corrupts nothing anyone is looking at. What this does not yet do is run the
 * candidate's code inside a Worker, which is what D-9 specifies and what the Node
 * prober already proves (AC-08). The `Prober` interface is unchanged, so that drops in
 * without touching this file; until it does, a candidate with an infinite loop would
 * wedge the page. That is a real gap and it is written down rather than glossed.
 */
import type { Candidate, Intent, Verdict } from '../contracts.js';
import { World } from '../core/world.js';
import { evaluateL0 } from '../harness/l0-static.js';
import { evaluateContract, readPath, toVerdict } from '../harness/l2-contract.js';
import { isInjectable, AUTHORITATIVE_LAYERS } from '../harness/cascade.js';
import { generateCandidates } from '../runtime/generate.js';
import type { BrowserModuleLoader, LoadedModule } from '../runtime/browser-loader.js';

export interface CycleStep {
  readonly at: number;
  readonly text: string;
  readonly kind: 'info' | 'reject' | 'accept';
}

export interface CycleOutcome {
  readonly ok: boolean;
  readonly ms: number;
  readonly steps: readonly CycleStep[];
  readonly verdicts: readonly Verdict[];
  readonly reason: string | null;
}

const PROBE_FRAMES = 120;
const FRAME_DT = 1 / 60;
const MAX_ATTEMPTS = 3;

/** L1 in the browser: run the candidate in a scratch world and watch the frames. */
async function probe(
  candidate: Candidate,
  intent: Intent,
  loader: BrowserModuleLoader,
): Promise<{ verdict: Omit<Verdict, 'candidateId'>; stateBefore: unknown; stateAfter: unknown }> {
  const scratch = new World();
  const fail = (layer: 'L1', diagnosis: string): Omit<Verdict, 'candidateId'> => ({
    passed: false, failedAt: layer, diagnosis, frame: null,
    metrics: { compileMs: null, medianFrameMs: null, drawCalls: null, pixelDelta: null, assertionsPassed: 0, assertionsTotal: 0 },
  });

  let mod: LoadedModule;
  try {
    mod = await loader.load(candidate.source);
  } catch (err) {
    return { verdict: fail('L1', `module failed to load: ${String(err)}`), stateBefore: {}, stateAfter: {} };
  }

  try {
    // `mount()` registers with the world itself (src/world/base.ts:179), because a
    // primitive cannot publish its declared state slice until it has one. The module
    // ABI returns what it mounted so the caller can track it -- not so the caller can
    // register it again. Doing both threw 'already registered' on every candidate.
    mod.mount(scratch);
  } catch (err) {
    return { verdict: fail('L1', `mount threw: ${String(err)}`), stateBefore: {}, stateAfter: {} };
  }

  const stateBefore = structuredClone(scratch.state);
  const frames: number[] = [];
  for (let i = 0; i < PROBE_FRAMES; i++) {
    const t0 = performance.now();
    try {
      scratch.tick(FRAME_DT);
    } catch (err) {
      return { verdict: fail('L1', `threw on frame ${i}: ${String(err)}`), stateBefore, stateAfter: {} };
    }
    frames.push(performance.now() - t0);
  }
  const stateAfter = structuredClone(scratch.state);

  // Median, not mean: one scheduler hitch would fail a candidate that is in fact
  // within budget. Same reasoning as the Node prober (AC-06).
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median > 16) {
    return { verdict: fail('L1', `median frame ${median.toFixed(2)} ms exceeds the 16 ms budget`), stateBefore, stateAfter };
  }

  return {
    verdict: {
      passed: true, failedAt: null, diagnosis: null, frame: null,
      metrics: { compileMs: null, medianFrameMs: median, drawCalls: null, pixelDelta: null, assertionsPassed: 0, assertionsTotal: 0 },
    },
    stateBefore,
    stateAfter,
  };
}

/**
 * What each state path currently holds, so re-uttering a verb supersedes rather than
 * collides. The world owns paths exclusively (a shared path would make every contract
 * over it non-deterministic), so the previous occupant is retired before the new one
 * claims it. The module ABI returns its mounted instances precisely so a caller can
 * track them; this is that use.
 */
const injected = new Map<string, string>();

export async function runCycle(
  intent: Intent,
  loader: BrowserModuleLoader,
  live: World,
  onStep?: (s: CycleStep) => void,
): Promise<CycleOutcome> {
  const t0 = performance.now();
  const steps: CycleStep[] = [];
  const verdicts: Verdict[] = [];
  const say = (text: string, kind: CycleStep['kind'] = 'info'): void => {
    const s = { at: performance.now() - t0, text, kind };
    steps.push(s);
    onStep?.(s);
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = generateCandidates(intent, attempt);
    say(`attempt ${attempt + 1}: ${candidates.length} candidates`);

    for (const candidate of candidates) {
      const l0 = evaluateL0(candidate, intent);
      if (!l0.passed) {
        verdicts.push({ ...l0, candidateId: candidate.id });
        say(`${candidate.strategy}: L0 — ${l0.diagnosis?.split('\n')[0]}`, 'reject');
        continue;
      }

      const { verdict: l1, stateBefore, stateAfter } = await probe(candidate, intent, loader);
      if (!l1.passed) {
        verdicts.push({ ...l1, candidateId: candidate.id });
        say(`${candidate.strategy}: L1 — ${l1.diagnosis}`, 'reject');
        continue;
      }

      const outcome = evaluateContract(intent.contract, stateBefore, stateAfter);
      const l2 = { ...toVerdict(outcome), candidateId: candidate.id, frame: null };
      verdicts.push(l2);
      if (!isInjectable(l2)) {
        say(`${candidate.strategy}: L2 — ${l2.diagnosis?.split('\n')[0]}`, 'reject');
        continue;
      }

      // Cleared every authoritative layer. L3 is advisory and cannot veto (AC-11).
      say(`${candidate.strategy}: cleared ${AUTHORITATIVE_LAYERS.join(', ')} — injecting`, 'accept');
      const mod = await loader.load(candidate.source);
      for (const d of intent.brief.directives) {
        const previous = injected.get(d.statePath);
        if (previous) {
          live.unregister(previous);   // disposes, and frees the path
          injected.delete(d.statePath);
        }
      }
      for (const m of mod.mount(live)) {
        injected.set(m.statePath, (m.instance as { id: string }).id);
      }
      live.recordVerb({ intentId: intent.id, utterance: intent.utterance, source: candidate.source });
      return { ok: true, ms: performance.now() - t0, steps, verdicts, reason: null };
    }
  }

  const reason = `all candidates failed across ${MAX_ATTEMPTS} attempts`;
  say(reason, 'reject');
  return { ok: false, ms: performance.now() - t0, steps, verdicts, reason };
}
