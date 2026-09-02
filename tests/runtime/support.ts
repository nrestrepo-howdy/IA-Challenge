/**
 * Runtime test doubles.
 *
 * Every one of them is deterministic and offline: the injector takes its module loader,
 * its clock, its generator and its repair agent as dependencies precisely so the cycle
 * can be verified with no browser, no blob URL and no API key (R-10).
 */
import type { Candidate, PrimitiveInstance, Verdict, WorldHandle } from '../../src/contracts.js';
import type { LoadedModule, ModuleLoader, MountedPrimitive } from '../../src/runtime/loader.js';

const noMetrics = {
  compileMs: null,
  medianFrameMs: null,
  drawCalls: null,
  pixelDelta: null,
  assertionsPassed: 0,
  assertionsTotal: 0,
} as const;

export function passingVerdict(candidateId: string): Verdict {
  return { candidateId, passed: true, failedAt: null, diagnosis: null, metrics: noMetrics, frame: null };
}

export function failingVerdict(candidateId: string, failedAt: Verdict['failedAt']): Verdict {
  return {
    candidateId,
    passed: false,
    failedAt,
    diagnosis: `${failedAt ?? 'nothing'} rejected it`,
    metrics: noMetrics,
    frame: null,
  };
}

export function candidate(over: Partial<Candidate> = {}): Candidate {
  return { id: 'cand-1', intentId: 'i1', strategy: 'direct', source: 'export function mount(){}', ...over };
}

export interface StubInstanceOptions {
  readonly id: string;
  readonly statePath: string;
  /** Frame index (1-based) on which `update` throws. Never, when omitted. */
  readonly throwOnTick?: number;
}

/** Counts its own disposal, because AC-15 is about `dispose()` actually running. */
export interface StubInstance extends PrimitiveInstance {
  readonly disposals: number;
  readonly ticks: number;
}

export function stubModule(world: WorldHandle, options: StubInstanceOptions): {
  module: LoadedModule;
  instances: StubInstance[];
} {
  const instances: StubInstance[] = [];
  const module: LoadedModule = {
    mount(): readonly MountedPrimitive[] {
      let ticks = 0;
      let disposals = 0;
      const instance: StubInstance = {
        id: options.id,
        get ticks() {
          return ticks;
        },
        get disposals() {
          return disposals;
        },
        update(dt: number) {
          ticks += 1;
          if (options.throwOnTick !== undefined && ticks === options.throwOnTick) {
            throw new Error(`stub primitive '${options.id}' failed on tick ${ticks}`);
          }
          // Writing through the live slice is the point of `slice()`: what the oracle
          // reads is the object the primitive updates, with no copy in between.
          world.slice(options.id).elapsed = ((world.slice(options.id).elapsed as number) ?? 0) + dt;
        },
        dispose() {
          disposals += 1;
        },
      };
      instances.push(instance);
      return [{ instance, statePath: options.statePath }];
    },
  };
  return { module, instances };
}

/** A module whose `mount` throws before anything is registered. */
export function explodingModule(message: string): LoadedModule {
  return {
    mount(): readonly MountedPrimitive[] {
      throw new Error(message);
    },
  };
}

/**
 * Serves pre-built modules by candidate id, counting what it hands out.
 *
 * `residentCount` mirrors the real loader's: a blob-URL module can never be freed
 * (R-4), so the count only ever grows, and a test can assert the budget is what bounds
 * it rather than any imaginary cleanup.
 */
export class StubModuleLoader implements ModuleLoader {
  #resident = 0;
  readonly loaded: string[] = [];

  constructor(private readonly modules: Map<string, LoadedModule>) {}

  get residentCount(): number {
    return this.#resident;
  }

  set(candidateId: string, module: LoadedModule): void {
    this.modules.set(candidateId, module);
  }

  async load(c: Candidate): Promise<LoadedModule> {
    const module = this.modules.get(c.id);
    if (module === undefined) throw new Error(`no stub module registered for '${c.id}'`);
    this.#resident += 1;
    this.loaded.push(c.id);
    return module;
  }
}

/** A clock a test drives by hand, so the 3 s window costs no wall-clock time. */
export function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
