/**
 * WS2 · module loading, behind one interface.
 *
 * The browser path for hot injection is `import(URL.createObjectURL(blob))`. That
 * import can never be undone: there is no API to clear the module namespace cache, so
 * every injected module stays resident for the life of the page (R-4). The leak is
 * structural, which is why the system bounds injections per session (D-6) rather than
 * pretending the memory comes back.
 *
 * Loading sits behind `ModuleLoader` for two reasons. It keeps the injector honest —
 * it can count what it can never free — and it keeps the test suite in plain Node with
 * no browser and no network, which is a property of the suite rather than a
 * convenience (R-10).
 */
import type { Candidate, PrimitiveInstance, WorldHandle } from '../contracts.js';

/**
 * One primitive a module put into the world, with the slice it declares.
 *
 * The module returns these rather than calling `world.register()` itself. Registration
 * is the only point at which the injector can wrap an instance in a rollback guard, so
 * routing it through here makes an unguarded injection unrepresentable rather than
 * merely discouraged (AC-13).
 */
export interface MountedPrimitive {
  readonly instance: PrimitiveInstance;
  /** Must lie inside `Intent.scope`; L0 has already rejected anything that does not (AC-05). */
  readonly statePath: string;
}

/** The shape every injected module exports. Nothing else is ever called on it. */
export interface LoadedModule {
  mount(world: WorldHandle): readonly MountedPrimitive[] | Promise<readonly MountedPrimitive[]>;
}

export interface ModuleLoader {
  load(candidate: Candidate): Promise<LoadedModule>;
  /** Modules resident for the life of the session. Only ever grows (R-4). */
  readonly residentCount: number;
}

export class ModuleShapeError extends Error {
  constructor(candidateId: string, detail: string) {
    super(`candidate '${candidateId}' loaded but is not an injectable module: ${detail}`);
    this.name = 'ModuleShapeError';
  }
}

/** Narrowing, not a cast: a module that lies about its shape fails here, not mid-frame. */
export function asLoadedModule(candidateId: string, value: unknown): LoadedModule {
  if (value === null || typeof value !== 'object') {
    throw new ModuleShapeError(candidateId, 'the module namespace is not an object');
  }
  if (typeof (value as { mount?: unknown }).mount !== 'function') {
    throw new ModuleShapeError(candidateId, "it exports no 'mount' function");
  }
  return value as LoadedModule;
}

/**
 * The browser path: a blob URL per candidate, imported once and never released.
 *
 * `residentCount` is deliberately public. It is the measurable form of R-4 — the
 * number the session budget exists to bound — and a leak nobody counts is a leak
 * nobody bounds (D-6, AC-15).
 */
export class BlobUrlModuleLoader implements ModuleLoader {
  readonly #urls: string[] = [];

  get residentCount(): number {
    return this.#urls.length;
  }

  async load(candidate: Candidate): Promise<LoadedModule> {
    if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error(
        'BlobUrlModuleLoader requires a browser. Supply a ModuleLoader stub in Node — the ' +
          'injector is deliberately agnostic about where a module comes from.',
      );
    }
    const url = URL.createObjectURL(new Blob([candidate.source], { type: 'text/javascript' }));
    // Retained on purpose: revoking the URL does not evict the module namespace, and
    // revoking it early only breaks a re-import (R-4).
    this.#urls.push(url);
    const namespace: unknown = await import(/* @vite-ignore */ url);
    return asLoadedModule(candidate.id, namespace);
  }
}
