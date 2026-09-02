/** WS2 runtime · hot injection, rollback, and the bounded verify-and-inject cycle. */
export { CANDIDATES_PER_ATTEMPT, rulesRepairAgent } from './agents.js';
export type {
  CandidateGenerator,
  FailureReport,
  GenerationRequest,
  RepairAgent,
  RepairGuidance,
  RepairRequest,
} from './agents.js';
export { MAX_ATTEMPTS, runCycle } from './cycle.js';
export type { AttemptRecord, CycleDeps, CycleResult, IntentAwareInjector } from './cycle.js';
export { DEFAULT_INJECTION_BUDGET, HotInjector, ROLLBACK_WINDOW_MS } from './injector.js';
export type { HotInjectorOptions, RollbackEvent } from './injector.js';
export { asLoadedModule, BlobUrlModuleLoader, ModuleShapeError } from './loader.js';
export type { LoadedModule, ModuleLoader, MountedPrimitive } from './loader.js';
