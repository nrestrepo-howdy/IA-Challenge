/**
 * Browser module loader.
 *
 * A generated candidate imports `verbo:rain-emitter`. Nothing resolves that: bare
 * specifiers need an import map, and a blob URL has no map. So each primitive gets a
 * tiny shim module published as its own blob URL, and the candidate's specifiers are
 * rewritten to point at them.
 *
 * The rewrite happens *after* L0 has analysed the source, never before. L0's whole
 * job is to reject imports outside the allowed set (AC-05); rewriting first would
 * hand it URLs instead of names and quietly disable the check.
 *
 * R-4 is unavoidable here: every blob URL imported becomes a module record that can
 * never be freed. `residentCount` only grows, and it is what the injection budget
 * (D-6) exists to bound. The URLs are revoked after import, which releases the blob
 * bytes; the module record stays. Pretending otherwise would be the comfortable lie.
 */
import type { Primitive } from '../contracts.js';

export interface LoadedModule {
  readonly mount: (world: unknown) => { instance: unknown; statePath: string }[];
}

export interface ModuleLoader {
  load(source: string): Promise<LoadedModule>;
  readonly residentCount: number;
}

const SPECIFIER = /(['"])verbo:([a-z0-9-]+)\1/gi;

export class BrowserModuleLoader implements ModuleLoader {
  #resident = 0;
  readonly #shims = new Map<string, string>();

  constructor(private readonly primitives: ReadonlyMap<string, Primitive<never>>) {
    // Shims index by name from a global; a Map is not indexable across a blob module
    // boundary, so the registry is published in the shape the shim can actually use.
    const plain: Record<string, unknown> = {};
    for (const [name, p] of primitives) plain[name] = p;
    (globalThis as Record<string, unknown>)['__VERBO_PRIMITIVES__'] = plain;
  }

  get residentCount(): number {
    return this.#resident;
  }

  /** One shim per primitive, created once and reused across every candidate. */
  #shimFor(name: string): string {
    const cached = this.#shims.get(name);
    if (cached) return cached;
    if (!this.primitives.has(name)) {
      throw new Error(`no primitive named '${name}' — L0 should have rejected this import`);
    }
    // The shim reads from a global rather than closing over the object, because a
    // blob module cannot capture a reference from the page that created it.
    const src = `const reg = globalThis.__VERBO_PRIMITIVES__;
if (!reg) throw new Error('primitive registry is absent');
export default reg[${JSON.stringify(name)}];`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    this.#shims.set(name, url);
    this.#resident++;
    return url;
  }

  async load(source: string): Promise<LoadedModule> {
    const rewritten = source.replace(SPECIFIER, (_m, q: string, name: string) =>
      `${q}${this.#shimFor(name)}${q}`);

    const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
    this.#resident++;
    try {
      const mod = (await import(/* @vite-ignore */ url)) as Partial<LoadedModule>;
      if (typeof mod.mount !== 'function') {
        throw new Error("module does not export mount(world); the ABI is { mount(world) -> {instance, statePath}[] }");
      }
      return { mount: mod.mount };
    } finally {
      // Frees the blob bytes. The module record is not freeable (R-4).
      URL.revokeObjectURL(url);
    }
  }
}
