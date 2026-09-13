/**
 * L3 · Perceptual oracle — advisory, never authoritative (D-1).
 *
 * This layer exists because a candidate can satisfy every state contract and still
 * produce nothing anyone can see: state that changes correctly while the picture does
 * not. It answers "did this become visible, and does it look like what was asked?"
 *
 * It does **not** answer "is this correct". WorldCoder-Bench measured external visual
 * failures in generated 3D as dominated by state-schema drift and broken interaction
 * chains rather than by missing scene elements -- and missing scene elements are what
 * looking at the picture is good at. The common failure is invisible to a critic; the
 * defective output (R-2). A system that lets this layer decide is built on an oracle
 * already measured as insufficient. `AUTHORITATIVE_LAYERS` in cascade.ts excludes L3,
 * and `isInjectable()` enforces it -- so nothing here can approve anything.
 *
 * Two stages, and the cheap one runs first:
 *
 *   1. **Pixel delta** (deterministic, microseconds). Did the frame change at all?
 *      Catches the degenerate case where a candidate mounts, ticks, satisfies its
 *      contract and renders nothing -- the visual equivalent of 'present but inert'.
 *   2. **Critic** (a vision model; seconds, per R-7). Only reached by candidates that
 *      already cleared L0, L1, L2 and the delta, which is what keeps its cost bounded.
 */
import type { Layer, Verdict } from '../contracts.js';

export interface Frame {
  readonly width: number;
  readonly height: number;
  /** RGBA, four bytes per pixel. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface DeltaResult {
  /** Fraction of pixels that changed beyond the threshold, 0..1. */
  readonly changed: number;
  /** Fraction of the after-frame that is not near-black. */
  readonly coverage: number;
}

/**
 * Per-channel difference against a threshold rather than an exact compare: an
 * antialiased edge shifts a handful of pixels by one or two units every frame, and a
 * test for exact equality would report a still image as constantly changing.
 */
export function pixelDelta(before: Frame, after: Frame, threshold = 6): DeltaResult {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`frame size changed between captures: ${before.width}x${before.height} -> ${after.width}x${after.height}`);
  }
  const total = after.width * after.height;
  let changed = 0;
  let lit = 0;
  for (let i = 0; i < after.data.length; i += 4) {
    const dr = Math.abs(after.data[i]! - before.data[i]!);
    const dg = Math.abs(after.data[i + 1]! - before.data[i + 1]!);
    const db = Math.abs(after.data[i + 2]! - before.data[i + 2]!);
    if (dr > threshold || dg > threshold || db > threshold) changed++;
    if (after.data[i]! > 8 || after.data[i + 1]! > 8 || after.data[i + 2]! > 8) lit++;
  }
  return { changed: changed / total, coverage: lit / total };
}

/** The vision model, behind an interface so the layer is testable without one. */
export interface VisualCritic {
  /** Actionable prose, not a score: a number cannot be acted on by a repair agent. */
  judge(frame: Frame, request: string): Promise<{ satisfied: boolean; note: string }>;
}

export interface L3Options {
  /** Below this, the candidate changed nothing visible and the critic is not consulted. */
  readonly minChanged?: number;
  readonly critic?: VisualCritic | undefined;
}

export const L3_LAYER: Layer = 'L3';

export async function evaluateL3(
  before: Frame,
  after: Frame,
  request: string,
  options: L3Options = {},
): Promise<Omit<Verdict, 'candidateId' | 'frame'>> {
  const minChanged = options.minChanged ?? 0.002;
  const delta = pixelDelta(before, after);

  const metrics = {
    compileMs: null, medianFrameMs: null, drawCalls: null,
    pixelDelta: delta.changed, assertionsPassed: 0, assertionsTotal: 0,
  } as const;

  if (delta.changed < minChanged) {
    return {
      passed: false,
      failedAt: L3_LAYER,
      diagnosis:
        `the frame changed by ${(delta.changed * 100).toFixed(3)}% of pixels, below the `
        + `${(minChanged * 100).toFixed(1)}% floor. State satisfied its contract but nothing became `
        + `visible -- check that the primitive is bound to something the renderer draws.`,
      metrics,
    };
  }

  if (!options.critic) {
    // No critic configured. This layer is advisory, so its absence must not read as
    // approval: it passes, and the diagnosis says exactly what was and was not checked.
    return {
      passed: true,
      failedAt: null,
      diagnosis: `pixel delta ${(delta.changed * 100).toFixed(2)}%; no visual critic configured, so appearance was not judged`,
      metrics,
    };
  }

  const judgement = await options.critic.judge(after, request);
  return {
    passed: judgement.satisfied,
    failedAt: judgement.satisfied ? null : L3_LAYER,
    diagnosis: judgement.note,
    metrics,
  };
}
