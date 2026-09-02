/** WS4 · intent. Compiles language into a (brief, contract) pair or an explained rejection. */
export { CATALOGUE, findPrimitive } from './catalogue.js';
export type { ParamSchema, PrimitiveSpec, PropertySchema, StateField } from './catalogue.js';
export { CatalogueIntentCompiler, isRejection } from './compiler.js';
export type { CodeBrief, CompiledIntent, CompilerOptions, PrimitiveDirective } from './compiler.js';
export { buildContract, buildWitness, CONTRACT_WINDOW_FRAMES } from './contract.js';
export type { Selection, Witness } from './contract.js';
export { buildPrompt, keywordModel, parseProposal } from './model.js';
export type { LanguageModel, ModelProposal, ModelRequest, ProposedPrimitive } from './model.js';
export { validateParams } from './schema.js';
export type { ParamViolation } from './schema.js';
