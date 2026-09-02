/**
 * `Prober`, implemented on `node:worker_threads`.
 *
 * D-3 rejects `try/catch` on the main thread for one reason: an infinite loop is not
 * throwable. There is nothing to catch. The only thing that stops it is killing the
 * thread it is running on, and that is a property of *workers*, not of browsers — a
 * `node:worker_threads` Worker and a Web Worker are both preemptively terminable from
 * outside. This implementation therefore buys the whole of AC-08 with no browser, no
 * GPU and no display, which is what makes the correctness-deciding layers of the
 * harness runnable in CI (docs/contracts/00-registry.md).
 *
 * The browser prober is the same object with a different constructor: it spawns a Web
 * Worker with an `OffscreenCanvas`, renders to an offscreen texture and reads it back
 * with `copyTextureToBuffer` + `mapAsync` (R-3, D-4), and calls the same `reportFrame`
 * shim. Everything above it — L1, the cascade, WS2 — depends only on `Prober` and
 * `ProbeResult`, so the swap is a constructor argument and nothing else.
 *
 * Satisfies the isolation half of AC-06, AC-07 and AC-08.
 */
import { Worker } from 'node:worker_threads';
import type { Candidate, FrameSample, Intent, ProbeResult, Prober } from '../contracts.js';

/**
 * `ProbeResult` with the two figures L1 needs that the frozen contract has no field
 * for. Structural extension rather than a contract change: WS2 consumes `Verdict`,
 * never `ProbeResult`, so nothing outside the harness can tell the difference — and
 * `src/contracts.ts` is a human decision made on `main`, not a worktree convenience.
 */
export interface NodeProbeResult extends ProbeResult {
  /** Peak per-frame draw calls observed. Surfaces as `Verdict.metrics.drawCalls`. */
  readonly drawCalls: number | null;
  /** Why it crashed, verbatim from the candidate. Feeds the L1 diagnosis. */
  readonly crashMessage: string | null;
}

/** SPEC §4.1: L1 watches 120 frames. Two seconds of a 60 fps world. */
export const DEFAULT_PROBE_FRAMES = 120;

/**
 * Worker entry point, as source rather than a file.
 *
 * The repo has no build step — `npm test` runs TypeScript through vitest directly — so
 * a `.ts` worker file would have nothing to load it. Passing the bootstrap as a string
 * with `eval: true` keeps the harness dependency-free and, more usefully, keeps the
 * protocol visible next to the shim that defines it.
 *
 * It runs as CommonJS, hence `require` and the async IIFE.
 */
const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');

// Duplicated from probe-shim.ts on purpose: this string is compiled in a separate
// realm with no module resolution back into the project. The shim exports the same
// function so the two probers agree on what "black" means.
function isAllBlack(px) {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] !== 0 || px[i + 1] !== 0 || px[i + 2] !== 0) return false;
  }
  return true;
}

function snapshot(v) {
  // An untrusted module can park anything in state; a snapshot that throws would look
  // like a crash in the candidate rather than in us.
  try { return structuredClone(v); } catch { try { return JSON.parse(JSON.stringify(v)); } catch { return null; } }
}

(async () => {
  const frames = [];
  let presented = null;
  let peakDrawCalls = 0;

  const state = {};
  globalThis.__VERBO_STATE__ = state;
  globalThis.__VERBO_PROBE__ = {
    reportFrame(r) {
      r = r || {};
      let allBlack = r.allBlack === true;
      if (r.pixels) { presented = r.pixels; allBlack = isAllBlack(r.pixels); }
      const dc = typeof r.drawCalls === 'number' ? r.drawCalls : 0;
      if (dc > peakDrawCalls) peakDrawCalls = dc;
      const ms = typeof r.gpuMs === 'number' && isFinite(r.gpuMs) ? r.gpuMs : 0;
      frames.push({ index: frames.length, gpuMs: ms, allBlack: allBlack });
    },
    present(px) { presented = px; },
  };

  const tail = () => ({
    frames: frames,
    pixels: presented ? Uint8Array.from(presented) : null,
    drawCalls: frames.length > 0 ? peakDrawCalls : null,
  });

  try {
    // R-4's analogue in Node. A blob URL cannot be released in the browser, and a data
    // URL cannot here either — which is exactly why the module is loaded inside a
    // thread we throw away rather than into the process that has to keep running.
    const url = 'data:text/javascript;base64,' + Buffer.from(workerData.source, 'utf8').toString('base64');
    const mod = await import(url);

    // R-5: init must resolve before a frame is probed, or we would be measuring a
    // program the user will never run.
    if (typeof mod.init === 'function') await mod.init();
    if (typeof mod.frame !== 'function') {
      throw new Error("module exports no frame(index) function; the probe shim requires one");
    }

    for (let i = 0; i < workerData.frames; i++) mod.frame(i);

    // L2 asserts over before/after snapshots taken around the scripted actions.
    const stateBefore = snapshot(state);
    let next = workerData.frames;
    for (const action of workerData.actions || []) {
      if (action.kind === 'advanceFrames') {
        const n = typeof action.payload === 'number' ? action.payload : 1;
        for (let i = 0; i < n; i++) mod.frame(next++);
      } else if (action.kind === 'wait') {
        const ms = typeof action.payload === 'number' ? action.payload : 0;
        await new Promise((r) => setTimeout(r, ms));
      } else if (action.kind === 'setState') {
        Object.assign(state, action.payload || {});
      } else if (action.kind === 'emit') {
        if (typeof mod.onEvent === 'function') mod.onEvent(action.payload);
      }
    }
    const stateAfter = snapshot(state);

    if (typeof mod.dispose === 'function') mod.dispose();

    parentPort.postMessage(Object.assign({ kind: 'done', stateBefore, stateAfter }, tail()));
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err);
    const stack = err && err.stack ? String(err.stack) : null;
    parentPort.postMessage(Object.assign({ kind: 'crashed', message, stack }, tail()));
  }
})();
`;

interface DoneMessage {
  kind: 'done';
  frames: FrameSample[];
  pixels: Uint8Array | null;
  drawCalls: number | null;
  stateBefore: unknown;
  stateAfter: unknown;
}
interface CrashMessage {
  kind: 'crashed';
  message: string;
  stack: string | null;
  frames: FrameSample[];
  pixels: Uint8Array | null;
  drawCalls: number | null;
}

export interface NodeProberOptions {
  /** Frames probed before the scripted actions run. */
  readonly frames?: number;
}

export class NodeProber implements Prober {
  readonly #frames: number;
  readonly #live = new Set<Worker>();

  constructor(options: NodeProberOptions = {}) {
    this.#frames = options.frames ?? DEFAULT_PROBE_FRAMES;
  }

  /**
   * Workers still running. Zero after every settled probe — the observable proof that
   * a timed-out candidate was killed rather than abandoned to spin (AC-08).
   */
  get activeWorkers(): number {
    return this.#live.size;
  }

  /**
   * Runs the candidate in its own thread and reports what happened.
   *
   * Never rejects. A crash, a timeout and a clean run are all *results*: L1 has to
   * turn each into a diagnosis a repair agent can act on, and an exception would
   * throw that information away at the one boundary that exists to preserve it.
   */
  async probe(c: Candidate, i: Intent, timeoutMs: number): Promise<NodeProbeResult> {
    const worker = new Worker(BOOTSTRAP, {
      eval: true,
      workerData: { source: c.source, frames: this.#frames, actions: [...i.contract.actions] },
      // An untrusted module's console output is noise, not evidence. Drained below.
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    this.#live.add(worker);

    return new Promise<NodeProbeResult>((resolve) => {
      let settled = false;

      const settle = (result: NodeProbeResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Terminated unconditionally, including on a clean finish: the module may have
        // left timers or microtasks running, and a candidate we are done with has no
        // business outliving its verdict.
        void worker.terminate().then(() => {
          this.#live.delete(worker);
          resolve(result);
        });
      };

      const timer = setTimeout(() => {
        // The load-bearing line of D-3. There is no catch here and there cannot be:
        // the thread is wedged, so it is killed. `settle` awaits `terminate()`, so by
        // the time the caller sees this result the thread is actually gone.
        settle(empty({ timedOut: true }));
      }, timeoutMs);

      worker.on('message', (msg: DoneMessage | CrashMessage) => {
        const common = {
          frames: msg.frames,
          pixels: msg.pixels ? Uint8Array.from(msg.pixels) : null,
          drawCalls: msg.drawCalls,
          timedOut: false,
        };
        settle(
          msg.kind === 'done'
            ? { ...common, crashed: false, crashMessage: null, stateBefore: msg.stateBefore, stateAfter: msg.stateAfter }
            : { ...common, crashed: true, crashMessage: msg.message, stateBefore: null, stateAfter: null },
        );
      });

      // Reached when the failure is not catchable inside the worker at all: an OOM, a
      // syntax error in the module, a hard `process.exit`.
      worker.on('error', (err: Error) => {
        settle(empty({ crashed: true, crashMessage: err.message }));
      });

      worker.on('exit', (code: number) => {
        if (code !== 0) settle(empty({ crashed: true, crashMessage: `worker exited with code ${code}` }));
        else settle(empty({ crashed: true, crashMessage: 'worker exited before reporting any frame' }));
      });
    });
  }

  /** Kills every worker still in flight. Nothing this class starts outlives it (R-4). */
  async dispose(): Promise<void> {
    const live = [...this.#live];
    this.#live.clear();
    await Promise.all(live.map((w) => w.terminate()));
  }
}

/** A result with no frames — every abnormal ending shares this shape. */
function empty(over: Partial<NodeProbeResult>): NodeProbeResult {
  return {
    crashed: false,
    timedOut: false,
    frames: [],
    stateBefore: null,
    stateAfter: null,
    pixels: null,
    drawCalls: null,
    crashMessage: null,
    ...over,
  };
}
