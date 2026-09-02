/**
 * Contract hardening by mutation (AC-10).
 *
 * A contract is not accepted on faith. Deliberate defects are applied to the observed
 * state and the contract must fail on every one of them. A verifier that cannot detect
 * known-bad input is not a verifier — it is a rubber stamp, and a rubber stamp on the
 * primary oracle would invalidate the entire harness.
 *
 * The mutation kinds mirror the dominant failure modes catalogued by WorldCoder-Bench:
 * State Schema Drift (42.8%) and Broken Interaction Chain (40.8%) account for the
 * overwhelming majority of real failures, so those are what we simulate.
 */
import type { Mutant, StateContract } from '../contracts.js';
import { evaluateContract, readPath } from './l2-contract.js';

/**
 * Applies a mutant, producing plausibly-broken state.
 *
 * Takes both snapshots because 'dropStateUpdate' is only meaningful relative to the
 * prior frame: a dropped update means the value never moved off where it started.
 * An earlier version cloned the after-value in place, which mutated nothing and let
 * unsound contracts pass hardening — the exact failure this module exists to prevent.
 */
export function applyMutant(
  before: unknown,
  after: unknown,
  mutant: Mutant,
  targetPath: string,
): unknown {
  const clone = structuredClone(after) as Record<string, unknown>;
  const parts = targetPath.split('.');
  const leaf = parts.pop()!;
  let node: any = clone;
  for (const p of parts) {
    if (node?.[p] === undefined) return clone;
    node = node[p];
  }

  switch (mutant.kind) {
    case 'dropStateUpdate': {
      // Present but inert: the classic "looks right, does nothing". The value is
      // rewound to its pre-action state, so anything asserting change must fire.
      const priorValue = readPath(before, targetPath);
      if (node && leaf in node && priorValue !== undefined) {
        node[leaf] = structuredClone(priorValue);
      }
      break;
    }
    case 'corruptConstant': {
      // The offset must be large and unconditional. An earlier version used
      // `v * 1000 + 1`, which cannot leave a [0, 1] box starting from zero -- so a
      // legitimately bounded field such as a black colour channel produced a mutant
      // its own assertion provably could not catch, and WS4 had to omit those
      // mutants to keep hardening honest. A mutant that cannot be caught is not a
      // weak test of the contract; it is a false accusation against it.
      const corrupt = (n: number): number => n * 1000 + 9973;
      const v = node?.[leaf];
      if (typeof v === 'number') node[leaf] = corrupt(v);
      else if (Array.isArray(v)) node[leaf] = v.map((n: number) => (typeof n === 'number' ? corrupt(n) : n));
      break;
    }
    case 'swapEventTarget':
      // Schema drift: the field the contract asks for stops existing.
      if (node && leaf in node) { node[`${leaf}_renamed`] = node[leaf]; delete node[leaf]; }
      break;
    case 'nullifyDisposer':
      if (node && leaf in node) node[leaf] = null;
      break;
  }
  return clone;
}

export interface HardeningReport {
  readonly hardened: boolean;
  readonly caught: readonly string[];
  readonly escaped: readonly string[];
  readonly reason: string | null;
}

/**
 * Runs every mutant against the contract. If any escapes, the contract is rejected
 * and must be regenerated (AC-10).
 */
export function hardenContract(
  contract: StateContract,
  before: unknown,
  after: unknown,
): HardeningReport {
  const caught: string[] = [];
  const escaped: string[] = [];

  for (const mutant of contract.mutants) {
    const assertion = contract.assertions.find((a) => a.id === mutant.mustBeCaughtBy);
    if (!assertion) {
      escaped.push(mutant.id);
      continue;
    }
    const mutated = applyMutant(before, after, mutant, assertion.path);
    const outcome = evaluateContract(contract, before, mutated);
    // It is not enough that *something* failed: the nominated assertion must be the
    // one that fired. Otherwise the contract caught it by accident.
    if (!outcome.passed && outcome.failedIds.includes(mutant.mustBeCaughtBy)) caught.push(mutant.id);
    else escaped.push(mutant.id);
  }

  return {
    hardened: escaped.length === 0,
    caught,
    escaped,
    reason: escaped.length === 0 ? null
      : `contract is not sound: mutants [${escaped.join(', ')}] were not caught by their nominated assertions`,
  };
}
