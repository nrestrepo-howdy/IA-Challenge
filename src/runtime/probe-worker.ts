/**
 * Probe worker — where untrusted candidate code actually runs.
 *
 * D-9: the candidate's *code* is isolated; pixels are rendered on the main thread
 * where Three.js is supported. Isolation is needed for code, not for pictures.
 *
 * The worker builds its own `World` and its own primitive registry. It does not
 * receive them from the page, and could not: a Worker has a separate global, and a
 * structured-cloned copy of a live object graph would not be the same world anyway.
 * Building them here is what makes the scratch world genuinely scratch.
 *
 * The important property is negative: this file contains no timeout logic. A module
 * that spins forever cannot be asked politely to stop, and a `try/catch` around an
 * infinite loop catches nothing. The main thread kills the worker instead (AC-08).
 */
import { World } from '../core/world.js';
import { createPrimitives } from '../world/index.js';
import type { ScriptedAction } from '../contracts.js';

export interface ProbeRequest {
  readonly source: string;
  readonly frames: number;
  readonly actions: readonly ScriptedAction[];
}

export interface ProbeReport {
  readonly ok: boolean;
  readonly failure: string | null;
  readonly frameMs: readonly number[];
  readonly stateBefore: unknown;
  readonly stateAfter: unknown;
}

const FRAME_DT = 1 / 60;
const SPECIFIER = /(['"])verbo:([a-z0-9-]+)\1/gi;

/**
 * The capability boundary, enforced by removal rather than by inspection.
 *
 * L0 reads the source and objects to names it recognises. That is a lint, and an
 * adversarial author defeats it in one line: `globalThis['fe'+'tch']` is a computed
 * member expression and no AST walk keyed on identifiers will see it. Twelve escapes
 * were written by hand and twelve passed L0.
 *
 * So the boundary lives here instead. A capability deleted from the worker's own
 * global cannot be reached by any spelling of its name, computed or otherwise — the
 * check is not "did you ask for this" but "is this here at all".
 *
 * Deliberately runs before the candidate is imported, and only inside the worker: the
 * page keeps its own `fetch`, and killing the worker (AC-08) is still what handles a
 * candidate that will not stop.
 */
function revokeCapabilities(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const name of [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
    'Notification', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker',
  ]) {
    try {
      Object.defineProperty(g, name, {
        value: undefined, writable: false, configurable: false, enumerable: false,
      });
    } catch {
      // A non-configurable host binding cannot be replaced. Nothing useful to do
      // about it here, and pretending otherwise would be worse than the gap.
    }
  }
}

self.onmessage = async (event: MessageEvent<ProbeRequest>) => {
  revokeCapabilities();
  const { source, frames } = event.data;
  const world = new World();
  const primitives = createPrimitives();
  const urls: string[] = [];

  const fail = (failure: string): void => {
    const report: ProbeReport = { ok: false, failure, frameMs: [], stateBefore: {}, stateAfter: {} };
    (self as unknown as Worker).postMessage(report);
  };

  try {
    // Same rewrite as the main-thread loader, applied to this worker's own registry.
    // The shim reads from this global, which is the worker's - not the page's.
    (globalThis as Record<string, unknown>)['__VERBO_PRIMITIVES__'] =
      Object.fromEntries([...primitives].map(([name, p]) => [name, p]));

    const rewritten = source.replace(SPECIFIER, (_m, q: string, name: string) => {
      if (!primitives.has(name)) throw new Error(`unknown primitive '${name}'`);
      const shim = `export default globalThis.__VERBO_PRIMITIVES__[${JSON.stringify(name)}];`;
      const url = URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));
      urls.push(url);
      return `${q}${url}${q}`;
    });

    const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
    urls.push(url);
    const mod = (await import(/* @vite-ignore */ url)) as { mount?: (w: unknown) => unknown };
    if (typeof mod.mount !== 'function') {
      return fail('module does not export mount(world)');
    }

    mod.mount(world);
    const stateBefore = structuredClone(world.state);
    const frameMs: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      world.tick(FRAME_DT);
      frameMs.push(performance.now() - t0);
    }

    const report: ProbeReport = {
      ok: true, failure: null, frameMs,
      stateBefore, stateAfter: structuredClone(world.state),
    };
    (self as unknown as Worker).postMessage(report);
  } catch (err) {
    fail(String(err));
  } finally {
    for (const u of urls) URL.revokeObjectURL(u);
  }
};
