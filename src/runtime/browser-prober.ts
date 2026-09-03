/**
 * Main-thread side of the probe: spawn, wait, and kill.
 *
 * The kill is the whole point (AC-08, D-9). A candidate that spins forever cannot be
 * caught -- `try/catch` around an infinite loop catches nothing, and a promise that
 * never settles cannot be rejected from inside. So the timeout lives out here, where
 * `terminate()` is available, and it genuinely destroys the thread.
 *
 * `terminate()` is awaited-equivalent by being synchronous, and `activeWorkers` is
 * exposed so a test can assert the thread is actually gone rather than merely
 * abandoned -- an abandoned worker still burns a core.
 */
import type { ProbeReport, ProbeRequest } from './probe-worker.js';

export interface BrowserProbeResult extends ProbeReport {
  readonly timedOut: boolean;
}

export class BrowserProber {
  #active = 0;

  get activeWorkers(): number {
    return this.#active;
  }

  async probe(request: ProbeRequest, timeoutMs: number): Promise<BrowserProbeResult> {
    const worker = new Worker(new URL('./probe-worker.js', import.meta.url), { type: 'module' });
    this.#active++;

    try {
      return await new Promise<BrowserProbeResult>((resolve) => {
        const done = (result: BrowserProbeResult): void => {
          clearTimeout(timer);
          worker.terminate();
          resolve(result);
        };
        const timer = setTimeout(() => {
          done({
            ok: false,
            failure: `did not finish within ${timeoutMs} ms and was terminated`,
            timedOut: true, frameMs: [], stateBefore: {}, stateAfter: {},
          });
        }, timeoutMs);

        worker.onmessage = (e: MessageEvent<ProbeReport>) => done({ ...e.data, timedOut: false });
        worker.onerror = (e) => done({
          ok: false,
          failure: e.message || 'the worker failed to start',
          timedOut: false, frameMs: [], stateBefore: {}, stateAfter: {},
        });

        worker.postMessage(request);
      });
    } finally {
      this.#active--;
    }
  }
}
