/**
 * The live cycle: utterance in, world changed out.
 *
 * Joins the five workstreams for the first time against a real renderer. Every piece
 * here already existed and was verified in isolation; this file only wires them, which
 * is the payoff of freezing the contracts before any of them were written.
 *
 *   utterance -> IntentCompiler -> 3 candidates -> cascade (L0, L1, L2) -> injection
 *
 * **The shadow.** A candidate is probed inside a Worker, against a scratch `World`
 * built there -- its own state tree, its own clock, never the live one. A candidate
 * that corrupts state corrupts nothing anyone is looking at, and one that spins
 * forever is killed rather than caught (D-9, AC-08). Pixels are still rendered on the
 * main thread, where Three.js is supported: isolation is needed for code, not for
 * pictures.
 */
import type { Candidate, Intent, Verdict } from '../contracts.js';
import type { World } from '../core/world.js';
import { evaluateL0 } from '../harness/l0-static.js';
import { evaluateContract, readPath, toVerdict } from '../harness/l2-contract.js';
import { isInjectable, AUTHORITATIVE_LAYERS } from '../harness/cascade.js';
import { evaluateL3, L3_LAYER, type Frame, type VisualCritic } from '../harness/l3-perceptual.js';
import { encodePng } from '../harness/png.js';
import { rulesRepairAgent, type RepairGuidance } from '../runtime/agents.js';
import { generateCandidates } from '../runtime/generate.js';
import type { BrowserModuleLoader } from '../runtime/browser-loader.js';
import { BrowserProber } from '../runtime/browser-prober.js';

export interface CycleStep {
  readonly at: number;
  readonly text: string;
  readonly kind: 'info' | 'reject' | 'accept';
  /**
   * Structured alongside the prose, not instead of it.
   *
   * The text is for a human reading a log; these fields are for anything that draws.
   * A renderer that parses the display string would break the moment the wording
   * changed, and the wording is the part most likely to change.
   */
  readonly candidate?: string;
  readonly layer?: 'L0' | 'L1' | 'L2' | 'L3';
  readonly attempt?: number;
}

export interface CycleOutcome {
  readonly ok: boolean;
  readonly ms: number;
  readonly steps: readonly CycleStep[];
  readonly verdicts: readonly Verdict[];
  readonly reason: string | null;
  /**
   * What L3 disliked about the world that was injected anyway, phrased as guidance.
   * Information for whoever asks next, never a reason the injection did not happen.
   */
  readonly advisory?: RepairGuidance;
}

/**
 * Where L3 gets its pixels and its opinion.
 *
 * Both optional, and both absent by default. With no `capture` there is no frame to
 * judge; with no `critic` -- the case whenever no API key is configured -- the delta
 * still runs and `evaluateL3` says in its diagnosis that appearance went unjudged.
 * Neither absence is allowed to look like approval, and neither can stall the cycle.
 */
export interface VisualReview {
  readonly capture?: (() => Promise<Frame>) | undefined;
  readonly critic?: VisualCritic | undefined;
}

/**
 * The live capture published by `main.ts`, found rather than injected.
 *
 * Reading the canvas from outside the animation loop returns an empty buffer (R-3),
 * so the only correct capture is the one inside the loop -- which lives in `main.ts`
 * and is published on `__VERBO__` for exactly this consumer. Resolved lazily because
 * this module is imported before that assignment runs.
 */
function liveCapture(): (() => Promise<Frame>) | undefined {
  const app = (globalThis as { __VERBO__?: { capture?: () => Promise<Frame> } }).__VERBO__;
  return app?.capture;
}

const PROBE_FRAMES = 120;
const FRAME_DT = 1 / 60;
const MAX_ATTEMPTS = 3;

/** L1 in the browser: run the candidate in a killable Worker and watch the frames. */
export const prober = new BrowserProber();

/** Generous relative to the 120-frame probe; tight enough that a spin is caught fast. */
const PROBE_TIMEOUT_MS = 4000;

async function probe(
  candidate: Candidate,
  intent: Intent,
): Promise<{ verdict: Omit<Verdict, 'candidateId'>; stateBefore: unknown; stateAfter: unknown }> {
  const noMetrics = {
    compileMs: null, medianFrameMs: null, drawCalls: null,
    pixelDelta: null, assertionsPassed: 0, assertionsTotal: 0,
  } as const;
  const fail = (diagnosis: string): Omit<Verdict, 'candidateId'> =>
    ({ passed: false, failedAt: 'L1', diagnosis, frame: null, metrics: noMetrics });

  const report = await prober.probe(
    { source: candidate.source, frames: PROBE_FRAMES, actions: intent.contract.actions },
    PROBE_TIMEOUT_MS,
  );

  if (!report.ok) {
    return {
      verdict: fail(report.failure ?? 'the probe reported no result'),
      stateBefore: report.stateBefore,
      stateAfter: report.stateAfter,
    };
  }

  // Median, not mean: one scheduler hitch would fail a candidate that is within
  // budget. Same reasoning as the Node prober (AC-06).
  const sorted = [...report.frameMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median > 16) {
    return {
      verdict: fail(`median frame ${median.toFixed(2)} ms exceeds the 16 ms budget`),
      stateBefore: report.stateBefore,
      stateAfter: report.stateAfter,
    };
  }

  return {
    verdict: {
      passed: true, failedAt: null, diagnosis: null, frame: null,
      metrics: { ...noMetrics, medianFrameMs: median },
    },
    stateBefore: report.stateBefore,
    stateAfter: report.stateAfter,
  };
}

/**
 * L3, run on the world that was just injected (D-1).
 *
 * It runs last and it runs *after* the mount, which is the honest place for it: the
 * only frame worth judging is the one the person is now looking at, and there is no
 * shadow renderer to produce one earlier. That ordering also removes the temptation
 * to let taste decide -- by the time this returns, the decision has been made by the
 * layers that are allowed to make it.
 *
 * Everything in here is therefore best-effort. No capture, no critic, a model that
 * times out, a frame that will not encode: each ends in a step that says what went
 * unchecked, and none of them changes what happened to the world.
 */
async function reviewVisually(
  candidate: Candidate,
  intent: Intent,
  before: Frame,
  after: Frame,
  critic: VisualCritic | undefined,
  attempt: number,
): Promise<{ verdict: Verdict; guidance: RepairGuidance | null }> {
  const l3 = await evaluateL3(before, after, intent.utterance, { critic });
  const verdict: Verdict = { ...l3, candidateId: candidate.id, frame: encodePng(after) };
  if (l3.passed) return { verdict, guidance: null };

  // A dissatisfied critic produces guidance, not a rollback. `rulesRepairAgent`
  // already knows what an L3 rejection means and says so in the guidance it writes;
  // routing through it keeps that wording in one place instead of a second opinion
  // about L3 forming here.
  const guidance = await rulesRepairAgent.repair({
    intent,
    attempt: attempt + 1,
    failures: [{
      candidateId: candidate.id,
      strategy: candidate.strategy,
      failedAt: L3_LAYER,
      diagnosis: l3.diagnosis ?? 'the critic reported no reason',
    }],
  });
  return { verdict, guidance };
}

/**
 * What each state path currently holds, so re-uttering a verb supersedes rather than
 * collides. The world owns paths exclusively -- a shared path would make every
 * contract over it non-deterministic -- so the previous occupant is retired before the
 * new one claims it. The module ABI returns its mounted instances precisely so a
 * caller can track them; this is that use.
 */
const injected = new Map<string, string>();

export async function runCycle(
  intent: Intent,
  loader: BrowserModuleLoader,
  live: World,
  onStep?: (s: CycleStep) => void,
  visual: VisualReview = {},
): Promise<CycleOutcome> {
  const t0 = performance.now();
  const steps: CycleStep[] = [];
  const verdicts: Verdict[] = [];
  const say = (text: string, kind: CycleStep['kind'] = 'info', extra: Partial<CycleStep> = {}): void => {
    const s: CycleStep = { at: performance.now() - t0, text, kind, ...extra };
    steps.push(s);
    onStep?.(s);
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = generateCandidates(intent, attempt);
    say(`attempt ${attempt + 1}: ${candidates.length} candidates`, 'info', { attempt });
    for (const c of candidates) say(`${c.strategy}: generated`, 'info', { candidate: c.strategy, attempt });

    for (const candidate of candidates) {
      const l0 = evaluateL0(candidate, intent);
      if (!l0.passed) {
        verdicts.push({ ...l0, candidateId: candidate.id });
        say(`${candidate.strategy}: L0 — ${l0.diagnosis?.split('\n')[0]}`, 'reject',
          { candidate: candidate.strategy, layer: 'L0', attempt });
        continue;
      }

      const { verdict: l1, stateBefore, stateAfter } = await probe(candidate, intent);
      if (!l1.passed) {
        verdicts.push({ ...l1, candidateId: candidate.id });
        say(`${candidate.strategy}: L1 — ${l1.diagnosis}`, 'reject',
          { candidate: candidate.strategy, layer: 'L1', attempt });
        continue;
      }

      const outcome = evaluateContract(intent.contract, stateBefore, stateAfter);
      const l2 = { ...toVerdict(outcome), candidateId: candidate.id, frame: null };
      verdicts.push(l2);
      if (!isInjectable(l2)) {
        say(`${candidate.strategy}: L2 — ${l2.diagnosis?.split('\n')[0]}`, 'reject',
          { candidate: candidate.strategy, layer: 'L2', attempt });
        continue;
      }

      // The 'before' frame is taken here rather than next to the mount: nothing about
      // the picture changes between these two points, and a capture waits for the next
      // rendered frame -- which, placed later, would put a visible delay between the
      // decision and the world changing.
      const capture = visual.capture ?? liveCapture();
      const before = capture ? await capture() : null;

      // Cleared every authoritative layer. L3 is advisory and cannot veto (AC-11).
      say(`${candidate.strategy}: cleared ${AUTHORITATIVE_LAYERS.join(', ')} — injecting`, 'accept',
        { candidate: candidate.strategy, attempt });
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

      let advisory: RepairGuidance | undefined;
      if (!capture || !before) {
        say('L3 — no frame capture available, so appearance was not judged', 'info',
          { layer: 'L3', attempt });
      } else {
        try {
          // Two frames, and the second is the one judged. Bindings are created by the
          // renderer's own reconcile pass, so the first frame after a mount is still
          // the picture from before it -- comparing against that would report every
          // successful injection as having changed nothing.
          await capture();
          const { verdict, guidance } = await reviewVisually(
            candidate, intent, before, await capture(), visual.critic, attempt,
          );
          verdicts.push(verdict);
          say(`L3 — ${verdict.diagnosis}`, 'info', { layer: 'L3', attempt });
          if (guidance) {
            advisory = guidance;
            say(guidance.instructions.join(' '), 'info', { layer: 'L3', attempt });
          }
        } catch (err) {
          // Including a critic that threw. The world keeps the injection; the log
          // keeps the fact that nobody looked at it.
          say(`L3 — did not complete (${String(err)}), so appearance was not judged`, 'info',
            { layer: 'L3', attempt });
        }
      }

      return { ok: true, ms: performance.now() - t0, steps, verdicts, reason: null, ...(advisory ? { advisory } : {}) };
    }
  }

  const reason = `all candidates failed across ${MAX_ATTEMPTS} attempts`;
  say(reason, 'reject');
  return { ok: false, ms: performance.now() - t0, steps, verdicts, reason };
}
