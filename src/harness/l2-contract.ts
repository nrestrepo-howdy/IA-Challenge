/**
 * L2 · State-contract oracle — the primary correctness oracle (D-1).
 *
 * WorldCoder-Bench reports failures in generated 3D dominated by state-schema drift and
 * broken interaction chains rather than by missing scene elements -- and missing scene
 * elements are what looking at the picture is good at. The benchmark verifies hidden
 * runtime state with mutation-hardened contracts for that reason. So does this, and the
 * visual critic is demoted to L3.
 *
 * This module is pure: it takes two state snapshots and a contract, and returns a
 * verdict. No browser, no GPU, no network. That is deliberate — the oracle that
 * decides correctness must itself be trivially testable.
 *
 * Satisfies AC-09.
 */
import type { Assertion, Layer, StateContract, Verdict } from '../contracts.js';

export interface AssertionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string | null;
}

/** Reads a dotted path out of a snapshot. Returns undefined for anything missing. */
export function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

export function checkAssertion(a: Assertion, before: unknown, after: unknown): AssertionResult {
  const value = readPath(after, a.path);
  const prior = readPath(before, a.path);
  const fail = (detail: string): AssertionResult => ({ id: a.id, passed: false, detail });
  const pass: AssertionResult = { id: a.id, passed: true, detail: null };

  switch (a.kind) {
    case 'exists':
      return value === undefined || value === null
        ? fail(`'${a.path}' is absent after the action`)
        : pass;

    case 'equals':
      return Object.is(value, a.expected)
        ? pass
        : fail(`'${a.path}' is ${fmt(value)}, expected ${fmt(a.expected)}`);

    case 'inRange': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return fail(`'${a.path}' is ${fmt(value)}, not a number`);
      }
      const lo = a.min ?? -Infinity;
      const hi = a.max ?? Infinity;
      return value >= lo && value <= hi
        ? pass
        : fail(`'${a.path}' is ${value}, outside [${lo}, ${hi}]`);
    }

    case 'changesOverTime':
      // The dominant real failure mode is a scene that looks right and does not move:
      // present but inert. This is the assertion that catches it.
      if (value === undefined) return fail(`'${a.path}' is absent, so it cannot change`);
      return deepEqual(prior, value)
        ? fail(`'${a.path}' did not change over ${a.window ?? 0} frames (value ${fmt(value)}) — present but inert`)
        : pass;

    case 'boundedBy': {
      const bound = a.expected as { min?: number[]; max?: number[] } | undefined;
      const v = value as number[] | undefined;
      if (!Array.isArray(v) || !bound) return fail(`'${a.path}' is not a bounded vector`);
      for (let k = 0; k < v.length; k++) {
        const lo = bound.min?.[k] ?? -Infinity;
        const hi = bound.max?.[k] ?? Infinity;
        const c = v[k]!;
        if (c < lo || c > hi) {
          return fail(`'${a.path}'[${k}] is ${c}, outside [${lo}, ${hi}] — escaped the world volume`);
        }
      }
      return pass;
    }
  }
}

export interface ContractOutcome {
  readonly passed: boolean;
  readonly results: readonly AssertionResult[];
  /** Ids of assertions that failed. Used by mutation hardening (AC-10). */
  readonly failedIds: readonly string[];
}

export function evaluateContract(
  contract: StateContract,
  before: unknown,
  after: unknown,
): ContractOutcome {
  const results = contract.assertions.map((a) => checkAssertion(a, before, after));
  const failedIds = results.filter((r) => !r.passed).map((r) => r.id);
  return { passed: failedIds.length === 0, results, failedIds };
}

export const L2_LAYER: Layer = 'L2';

export function toVerdict(outcome: ContractOutcome): Omit<Verdict, 'candidateId' | 'frame'> {
  const passedCount = outcome.results.filter((r) => r.passed).length;
  return {
    passed: outcome.passed,
    failedAt: outcome.passed ? null : L2_LAYER,
    diagnosis: outcome.passed ? null
      : outcome.results.filter((r) => !r.passed).map((r) => `[${r.id}] ${r.detail}`).join('\n'),
    metrics: {
      compileMs: null, medianFrameMs: null, drawCalls: null, pixelDelta: null,
      assertionsPassed: passedCount, assertionsTotal: outcome.results.length,
    },
  };
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return `'${v}'`;
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}
