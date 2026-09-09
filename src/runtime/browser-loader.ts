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
 *
 * **The budget is enforced here, because here is where the leak happens.** It was
 * declared in `HotInjector` (D-6, `DEFAULT_INJECTION_BUDGET`) and the live cycle does
 * not go through `HotInjector` — it loads modules straight through this class — so
 * for every session anyone has actually run, the bound was a number in a file that
 * nothing consulted. A budget only bounds what it sits in front of.
 */
import type { Primitive } from '../contracts.js';
import { DEFAULT_INJECTION_BUDGET } from './injector.js';

export interface LoadedModule {
  readonly mount: (world: unknown) => { instance: unknown; statePath: string }[];
}

export interface ModuleLoader {
  load(source: string): Promise<LoadedModule>;
  readonly residentCount: number;
}

const SPECIFIER = /(['"])verbo:([a-z0-9-]+)\1/gi;

/**
 * Refusing to load, said in a way a caller can pass on.
 *
 * A distinct type rather than a bare `Error` so `runCycle` can tell "the session is
 * over its budget", which is an answer, from "this module is broken", which is a
 * failure — and report each as what it is instead of one generic apology.
 */
export class InjectionBudgetError extends Error {
  constructor(readonly budget: number) {
    super(
      `injection budget exhausted: ${budget} modules loaded this session. ES modules imported ` +
      'via blob URL can never be released (R-4), so the budget is bounded rather than pretended ' +
      'away (D-6). Reload the world to start a new session.',
    );
    this.name = 'InjectionBudgetError';
  }
}

export class BrowserModuleLoader implements ModuleLoader {
  #resident = 0;
  #spent = 0;
  readonly #budget: number;
  readonly #shims = new Map<string, string>();

  constructor(
    private readonly primitives: ReadonlyMap<string, Primitive<never>>,
    budget: number = DEFAULT_INJECTION_BUDGET,
  ) {
    this.#budget = budget;
    // Shims index by name from a global; a Map is not indexable across a blob module
    // boundary, so the registry is published in the shape the shim can actually use.
    const plain: Record<string, unknown> = {};
    for (const [name, p] of primitives) plain[name] = p;
    (globalThis as Record<string, unknown>)['__VERBO_PRIMITIVES__'] = plain;
  }

  /**
   * Every module record this loader has made permanently resident, shims included.
   * The honest total, and the reason it only ever grows (R-4).
   */
  get residentCount(): number {
    return this.#resident;
  }

  /**
   * Candidate loads left this session. Named to match `Injector.remainingBudget`,
   * because it answers the same question about the same leak.
   *
   * Shims are excluded: there is one per primitive, created once and reused, so they
   * are bounded by the catalogue rather than by use. Charging them to a per-session
   * budget would make the number of injections a user gets depend on which verbs they
   * happened to say first.
   */
  get remainingBudget(): number {
    return Math.max(0, this.#budget - this.#spent);
  }

  /** The bound itself, so a refusal can quote the number it is refusing against. */
  get injectionBudget(): number {
    return this.#budget;
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
    // Before the blob is made, not after: the refusal has to happen while there is
    // still nothing to leak.
    if (this.remainingBudget <= 0) throw new InjectionBudgetError(this.#budget);

    const rewritten = source.replace(SPECIFIER, (_m, q: string, name: string) =>
      `${q}${this.#shimFor(name)}${q}`);

    const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
    this.#resident++;
    this.#spent++;
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
