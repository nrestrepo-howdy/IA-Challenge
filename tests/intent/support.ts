/**
 * Test doubles for WS4.
 *
 * The model is a stub in every test, on purpose: the intent compiler feeds the layer
 * that decides correctness, so its own suite must be reproducible for a third party
 * with no key and no network (R-10).
 */
import type { PrimitiveInstance, WorldHandle, WorldSnapshot } from '../../src/contracts.js';
import type { LanguageModel } from '../../src/intent/model.js';

export function stubModel(reply: unknown): LanguageModel {
  return { propose: () => Promise.resolve(typeof reply === 'string' ? reply : JSON.stringify(reply)) };
}

export function failingModel(message: string): LanguageModel {
  return { propose: () => Promise.reject(new Error(message)) };
}

export function fakeWorld(state: Record<string, unknown> = {}): WorldHandle {
  return {
    scene: {},
    clock: { elapsed: 0 },
    register: (_inst: PrimitiveInstance, _statePath: string) => {},
    unregister: (_id: string) => {},
  slice: (_id: string) => ({}),
  recordVerb: () => {},
    state,
    snapshot: (): WorldSnapshot => ({ version: 1, verbs: [], userState: null }),
    restore: (_s: WorldSnapshot) => {},
  };
}
