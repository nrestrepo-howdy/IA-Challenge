/**
 * Shared test fixtures.
 *
 * Introduced when a single contract amendment broke the same hand-rolled `Intent`
 * literal in four separate test files. Each workstream had written its own because
 * each could only see its own workstream -- which is the predictable cost of
 * isolation, and the kind of thing integration is for.
 */
import type { CodeBrief, Intent, PrimitiveInstance, WorldHandle, WorldSnapshot } from '../src/contracts.js';

/** A brief with no directives: enough to satisfy the type where content is irrelevant. */
export const EMPTY_BRIEF: CodeBrief = {
  goal: 'test fixture',
  rationale: 'no code is generated in this test',
  directives: [],
  steps: [],
  constraints: [],
};

export function makeIntent(over: Partial<Intent> = {}): Intent {
  return {
    id: 'i1',
    utterance: 'make it rain',
    allowedPrimitives: ['emitter'],
    scope: ['weather.rain'],
    contract: { id: 'c1', assertions: [], actions: [], mutants: [] },
    brief: EMPTY_BRIEF,
    ...over,
  };
}

/** A `WorldHandle` that satisfies the interface without implementing a world. */
export function stubWorldHandle(over: Partial<WorldHandle> = {}): WorldHandle {
  const state: Record<string, unknown> = {};
  return {
    scene: {},
    clock: { elapsed: 0 },
    register: (_inst: PrimitiveInstance, _statePath: string) => {},
    unregister: (_id: string) => {},
    slice: (_id: string) => ({}),
    recordVerb: (_v: WorldSnapshot['verbs'][number]) => {},
    state,
    snapshot: (): WorldSnapshot => ({ version: 1, verbs: [], userState: {} }),
    restore: (_s: WorldSnapshot) => {},
    ...over,
  };
}
