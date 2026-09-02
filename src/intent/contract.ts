/**
 * Contract synthesis — deterministic, never delegated to the model.
 *
 * The model chooses *which* primitives answer the utterance; it never writes the
 * oracle that decides whether the result is correct. D-1 makes the state contract the
 * primary oracle, and a primary oracle produced by the same fallible process it is
 * meant to police would be worth nothing. So contract generation is a pure function of
 * the catalogue entry plus the resolved parameters.
 *
 * Soundness is the whole game (AC-10, §4.3): every mutant must be caught by the
 * assertion that nominates it, under `hardenContract()`. That constrains the mapping,
 * because assertion strength is not uniform —
 *
 *   role     → assertion         → mutants it can actually catch
 *   constant → equals            → corruptConstant (corruptValue(x) ≠ x), swapEventTarget (absent)
 *   vector   → boundedBy         → corruptConstant (components leave the volume)
 *   animated → changesOverTime   → dropStateUpdate (value rewound to its prior frame)
 *   resource → exists            → nullifyDisposer (null is not present)
 *
 * `exists` appears exactly once, and only against the mutant it can catch: an `exists`
 * assertion survives a corrupted constant, so pairing those two would produce a
 * rubber stamp on the layer that decides correctness.
 */
import type { Assertion, Mutant, ScriptedAction, StateContract } from '../contracts.js';
import type { PrimitiveSpec } from './catalogue.js';
import { corruptValue } from '../harness/mutation.js';

/** A catalogue entry with its parameters resolved and validated. */
export interface Selection {
  readonly spec: PrimitiveSpec;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Frames between the before and after snapshots. Long enough for one gust period. */
export const CONTRACT_WINDOW_FRAMES = 30;

/**
 * The state the contract is hardened against before it is ever emitted.
 *
 * `hardenContract()` needs a before/after pair to mutate, and at compile time no
 * candidate has run yet — so the catalogue's declared field witnesses stand in for one.
 * A contract that cannot catch its mutants against the *expected* state certainly
 * cannot catch them against a real one.
 */
export interface Witness {
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

export function buildContract(id: string, selections: readonly Selection[]): StateContract {
  const assertions: Assertion[] = [];
  const mutants: Mutant[] = [];

  for (const { spec, params } of selections) {
    for (const field of spec.fields) {
      const path = `${spec.statePath}.${field.key}`;
      const aid = `a:${path}`;

      switch (field.role) {
        case 'constant': {
          const expected = params[field.fromParam];
          assertions.push({ id: aid, path, kind: 'equals', expected });
          // Schema drift renames the field; both mutants land on `equals` because it is
          // the only assertion that pins the value the utterance actually asked for.
          mutants.push({ id: `m:drift:${path}`, kind: 'swapEventTarget', mustBeCaughtBy: aid });
          if (typeof expected === 'number') {
            mutants.push({ id: `m:corrupt:${path}`, kind: 'corruptConstant', mustBeCaughtBy: aid });
          }
          break;
        }

        case 'vector': {
          const bounds = { min: [...field.bounds.min], max: [...field.bounds.max] };
          assertions.push({ id: aid, path, kind: 'boundedBy', expected: bounds });
          // Only nominate the mutant this assertion can genuinely catch. A corrupted
          // component is corruptValue(c), which escapes the volume for every realistic value
          // but not for an all-zero vector inside a [0,1] box (black, say). Nominating
          // it anyway would make the contract fail hardening and reject a request that
          // is perfectly legal — so the check is made here rather than discovered later.
          if (escapesBounds(params[field.fromParam], bounds)) {
            mutants.push({ id: `m:corrupt:${path}`, kind: 'corruptConstant', mustBeCaughtBy: aid });
          }
          break;
        }

        case 'animated': {
          assertions.push({ id: aid, path, kind: 'changesOverTime', window: CONTRACT_WINDOW_FRAMES });
          // "Looks right, does nothing" is the failure R-1 is really measuring.
          mutants.push({ id: `m:inert:${path}`, kind: 'dropStateUpdate', mustBeCaughtBy: aid });
          break;
        }

        case 'resource': {
          assertions.push({ id: aid, path, kind: 'exists' });
          // R-4: the blob-URL module leak is structural, so a live instance handle is
          // the only evidence that anything is disposable at all.
          mutants.push({ id: `m:dispose:${path}`, kind: 'nullifyDisposer', mustBeCaughtBy: aid });
          break;
        }
      }
    }
  }

  const actions: readonly ScriptedAction[] = [
    { kind: 'advanceFrames', payload: CONTRACT_WINDOW_FRAMES },
  ];

  return { id, assertions, actions, mutants };
}

/** The expected before/after snapshots implied by the same selections. */
export function buildWitness(selections: readonly Selection[]): Witness {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  for (const { spec, params } of selections) {
    for (const field of spec.fields) {
      const path = `${spec.statePath}.${field.key}`;
      switch (field.role) {
        case 'constant':
        case 'vector': {
          const v = params[field.fromParam];
          setPath(before, path, clone(v));
          setPath(after, path, clone(v));
          break;
        }
        case 'animated':
          setPath(before, path, clone(field.witness[0]));
          setPath(after, path, clone(field.witness[1]));
          break;
        case 'resource':
          setPath(before, path, clone(field.witness));
          setPath(after, path, clone(field.witness));
          break;
      }
    }
  }

  return { before, after };
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const leaf = parts.pop()!;
  let node = root;
  for (const p of parts) {
    const next = node[p];
    if (typeof next !== 'object' || next === null) node[p] = {};
    node = node[p] as Record<string, unknown>;
  }
  node[leaf] = value;
}

/** Uses `applyMutant`'s own corruption, imported rather than mirrored: does it leave the box? */
function escapesBounds(
  value: unknown,
  bounds: { readonly min: readonly number[]; readonly max: readonly number[] },
): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((c: unknown, k: number) => {
    if (typeof c !== 'number') return false;
    const corrupted = corruptValue(c);
    return corrupted < (bounds.min[k] ?? -Infinity) || corrupted > (bounds.max[k] ?? Infinity);
  });
}

function clone<T>(v: T): T {
  return Array.isArray(v) ? ([...v] as unknown as T) : v;
}
