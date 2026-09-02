/**
 * The probe shim — the seam between a candidate module and whatever is running it.
 *
 * SPEC §4.1 puts every candidate inside a Worker with an OffscreenCanvas. Two of those
 * three words are about the browser; only "Worker" is about the guarantee. The
 * guarantee is that an infinite loop can be *killed* rather than caught (D-3), and it
 * is identical in a Web Worker and in a `node:worker_threads` Worker.
 *
 * So this module defines the part that must not differ between the two: the shape a
 * candidate module exports, and the globals it reports through. A browser prober and
 * the Node prober in `prober-node.ts` both satisfy `Prober`, both drive a module
 * through this same protocol, and L1 never learns which one it got.
 *
 * There is no GPU in Node, so the candidate hands us its `FrameSample`s directly
 * instead of us reading them off a timestamp-query. That trade is deliberate: this
 * layer decides isolation, timeout and verdict semantics, and a fake GPU weakens none
 * of the three. Under the browser prober the same `reportFrame` call is made by the
 * primitive runtime from real timestamp-query values (R-6) and a real
 * `copyTextureToBuffer` readback (R-3).
 */
import type { FrameSample } from '../contracts.js';

/** Global the candidate reports through. Named to match `__VERBO_STATE__`. */
export const PROBE_GLOBAL = '__VERBO_PROBE__';

/** Global holding the observable state L2 asserts over. */
export const STATE_GLOBAL = '__VERBO_STATE__';

/**
 * What a candidate reports for one frame.
 *
 * `drawCalls` rides here rather than on `FrameSample` because `contracts.ts` is frozen
 * and a per-frame draw-call count is a harness-internal budget input, not part of the
 * WS2 boundary. The prober folds the series into a single peak figure.
 */
export interface FrameReport {
  /** Elapsed GPU time for the frame. Quantized to 100 µs in the browser (R-6). */
  readonly gpuMs: number;
  /** Set when the module knows the frame was blank and has no pixels to prove it with. */
  readonly allBlack?: boolean;
  readonly drawCalls?: number;
  /**
   * RGBA readback of the frame. When present, blackness is computed from it rather
   * than trusted from `allBlack` — a candidate does not get to self-certify AC-07.
   */
  readonly pixels?: Uint8Array;
}

/** The shim object installed as `globalThis.__VERBO_PROBE__` inside the worker. */
export interface ProbeShim {
  reportFrame(report: FrameReport): void;
  /** Latest readback. Kept as the verdict's visual proof (`Verdict.frame`). */
  present(pixels: Uint8Array): void;
}

/**
 * What a candidate ES module must export.
 *
 * `init` is awaited and must resolve before any frame is probed: R-5 says skipping
 * `await renderer.init()` ships a black first frame, so a harness that probed before
 * init resolved would be verifying a different program than the one that ships.
 */
export interface CandidateModule {
  init?(): void | Promise<void>;
  /** Called once per probed frame. Reports through the shim; any return is ignored. */
  frame(index: number): void;
  /** Receives the payload of an `emit` scripted action. */
  onEvent?(payload: unknown): void;
  /** Mandatory in the primitive library (R-4); optional for a bare probe module. */
  dispose?(): void;
}

/** True when every pixel is black. Alpha is ignored: a transparent frame still shows nothing. */
export function isAllBlack(pixels: Uint8Array): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) return false;
  }
  return true;
}

/** Median frame time. Even-length samples average the middle pair. */
export function medianGpuMs(frames: readonly FrameSample[]): number | null {
  if (frames.length === 0) return null;
  const sorted = frames.map((f) => f.gpuMs).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
