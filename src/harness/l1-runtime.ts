/**
 * L1 · Runtime oracle.
 *
 * The second layer and the last cheap one. L0 proved the module parses; L1 proves it
 * *runs* — that `init()` resolved (R-5), that nothing threw across 120 frames, that
 * the median frame fits in 16 ms, that it drew something, and that a candidate which
 * never finishes is killed rather than waited on.
 *
 * L1 does not run the candidate itself. It asks a `Prober` to, and the prober owns
 * the isolation (D-3). That split is the reason this file is pure verdict logic with
 * no worker, no GPU and no browser in it: swapping the Node prober for the browser one
 * changes nothing here.
 *
 * Satisfies AC-06 (frame budget), AC-07 (black frame) and AC-08 (timeout kill).
 */
import type { Candidate, Intent, Layer, Oracle, ProbeResult, Verdict } from '../contracts.js';
import { medianGpuMs } from './probe-shim.js';

export const L1_LAYER: Layer = 'L1';

/**
 * SPEC §4.1 gives L1 a ~200 ms compute budget. That is what the layer is allowed to
 * cost, not how long a candidate is allowed to hang: this is the figure the cascade
 * schedules against.
 */
export const L1_BUDGET_MS = 200;

/**
 * AC-06. 16 ms is one frame at 60 fps; R-9 says an injection must never take the
 * user's world below 30 fps, and a candidate that is already at the 60 fps line in
 * isolation has nothing left to spend once the base scene is under it too.
 */
export const FRAME_BUDGET_MS = 16;

/**
 * Draw calls a single candidate may add. Not in SPEC — SPEC §4.1 requires *a*
 * draw-call budget and leaves the number to the harness — so it is stated here, in
 * one place, and is overridable per intent rather than scattered as a magic number.
 */
export const DRAW_CALL_BUDGET = 200;

/**
 * How long a candidate may hang before its thread is killed.
 *
 * Deliberately much larger than `L1_BUDGET_MS`: worker spin-up and module import are
 * harness cost, not candidate cost, and a timeout tight enough to catch them would
 * report every slow-but-terminating candidate as an infinite loop. Slowness is
 * AC-06's job and is judged from frame times; this number exists only so that
 * "never returns" has a finite answer (AC-08).
 */
export const PROBE_TIMEOUT_MS = 2_000;

export interface L1Options {
  readonly frameBudgetMs?: number;
  readonly drawCallBudget?: number;
  readonly timeoutMs?: number;
}

/** `drawCalls` and the crash message ride on the prober's result; see prober-node.ts. */
type ProbeExtras = ProbeResult & {
  readonly drawCalls?: number | null;
  readonly crashMessage?: string | null;
};

/**
 * Turns a probe into a verdict.
 *
 * Exported separately from the oracle so the decision can be tested against a
 * synthetic `ProbeResult` with no worker at all — the rule and the machinery that
 * feeds it fail independently, and a test should be able to say which one broke.
 */
export function verdictFromProbe(
  result: ProbeResult,
  options: L1Options = {},
): Omit<Verdict, 'candidateId'> {
  const frameBudget = options.frameBudgetMs ?? FRAME_BUDGET_MS;
  const drawCallBudget = options.drawCallBudget ?? DRAW_CALL_BUDGET;
  const extras = result as ProbeExtras;

  const median = medianGpuMs(result.frames);
  const drawCalls = extras.drawCalls ?? null;
  const metrics = {
    compileMs: null,
    medianFrameMs: median,
    drawCalls,
    pixelDelta: null,
    assertionsPassed: 0,
    assertionsTotal: 0,
  } as const;

  // Raw RGBA readback rather than a PNG: encoding belongs to the prober that produced
  // real pixels (R-3), and there is no compositor here to produce any.
  const frame = result.pixels;

  const reject = (diagnosis: string): Omit<Verdict, 'candidateId'> =>
    ({ passed: false, failedAt: L1_LAYER, diagnosis, metrics, frame });

  // Terminal first. Neither of these produced a program worth measuring, so reporting
  // a frame-budget complaint on top would send the repair agent after the wrong bug.
  if (result.timedOut) {
    return reject(
      `The candidate never finished its probe and its worker was killed after the timeout. ` +
        `This is the signature of an unbounded loop — most often a while/for in init() or ` +
        `frame() whose exit condition never becomes true, or an await on a promise nothing ` +
        `resolves. Bound every loop by frame index or elapsed time.`,
    );
  }

  if (result.crashed) {
    const why = extras.crashMessage ? ` It reported: ${extras.crashMessage}` : '';
    return reject(
      `The candidate threw before completing its probe, so no frame budget could be ` +
        `measured.${why} Fix the exception first; L1 cannot say anything about a module ` +
        `that does not run.`,
    );
  }

  if (result.frames.length === 0 || median === null) {
    return reject(
      `The candidate ran to completion but reported no frames. A probed module must call ` +
        `__VERBO_PROBE__.reportFrame() from frame(index); without it there is nothing to ` +
        `verify and the module is indistinguishable from one that renders nothing.`,
    );
  }

  // AC-07. R-5 is the usual cause: WebGPURenderer needs `await renderer.init()`, and
  // skipping it ships exactly this — a module that runs, reports, and shows nothing.
  const black = result.frames.filter((f) => f.allBlack);
  if (black.length > 0) {
    const first = black[0]!.index;
    return reject(
      `${black.length} of ${result.frames.length} probed frames were entirely black, ` +
        `starting at frame ${first}. The module runs but puts nothing on screen. Check that ` +
        `init() is awaited before the first frame (R-5), that the material and light are ` +
        `actually mounted into the scene, and that the emitter is emitting.`,
    );
  }

  // AC-06. Median rather than mean: one compile hitch during warm-up should not
  // condemn a module, and a mean lets a genuinely slow module hide behind fast frames.
  if (median > frameBudget) {
    const worst = Math.max(...result.frames.map((f) => f.gpuMs));
    return reject(
      `Median frame time is ${median.toFixed(2)} ms over ${result.frames.length} frames, ` +
        `above the ${frameBudget} ms budget (worst frame ${worst.toFixed(2)} ms). At this cost ` +
        `the candidate alone cannot hold 60 fps, and R-9 forbids an injection dropping the ` +
        `user's world below 30 fps. Reduce particle count, merge draw calls, or move ` +
        `per-frame work into the compute pass.`,
    );
  }

  if (drawCalls !== null && drawCalls > drawCallBudget) {
    return reject(
      `Peak draw calls per frame is ${drawCalls}, above the ${drawCallBudget} budget. ` +
        `Instance the geometry or batch into a single emitter rather than mounting one ` +
        `object per particle.`,
    );
  }

  return { passed: true, failedAt: null, diagnosis: null, metrics, frame };
}

/**
 * The L1 oracle.
 *
 * Takes its `Prober` by injection, which is the whole seam: the Node prober here, a
 * Worker + OffscreenCanvas prober in the browser, and a stub in a unit test all satisfy
 * the same interface, and this oracle cannot tell them apart.
 */
export function createL1Oracle(
  prober: { probe(c: Candidate, i: Intent, timeoutMs: number): Promise<ProbeResult> },
  options: L1Options = {},
): Oracle {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  return {
    layer: L1_LAYER,
    budgetMs: L1_BUDGET_MS,
    async evaluate(c: Candidate, i: Intent): Promise<Omit<Verdict, 'candidateId'>> {
      return verdictFromProbe(await prober.probe(c, i, timeoutMs), options);
    },
  };
}
