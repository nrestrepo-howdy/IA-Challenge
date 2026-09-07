/** WS2 runtime · hot injection, rollback, and the bounded verify-and-inject cycle. */
export { CANDIDATES_PER_ATTEMPT, rulesRepairAgent } from './agents.js';
export type {
  CandidateGenerator,
  FailureReport,
  GenerationRequest,
  ParamAdjustment,
  RepairAgent,
  RepairGuidance,
  RepairRequest,
} from './agents.js';
export { ClaudeRepairAgent, resolveRepairAgent } from './claude-repair.js';
export type { ClaudeRepairAgentOptions } from './claude-repair.js';
export { applyGuidance, generateCandidates, orderStrategies, REPAIR_BAND, STRATEGIES, templateGenerator } from './generate.js';
export type { CandidateStrategy } from './generate.js';
export { MAX_ATTEMPTS, runCycle } from './cycle.js';
export type { AttemptRecord, CycleDeps, CycleResult, IntentAwareInjector } from './cycle.js';
export { DEFAULT_INJECTION_BUDGET, HotInjector, ROLLBACK_WINDOW_MS } from './injector.js';
export type { HotInjectorOptions, RollbackEvent } from './injector.js';
export { asLoadedModule, BlobUrlModuleLoader, ModuleShapeError } from './loader.js';
export type { LoadedModule, ModuleLoader, MountedPrimitive } from './loader.js';
