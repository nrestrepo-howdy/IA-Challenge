/**
 * WS5 · Seeded pseudo-randomness.
 *
 * Nothing in a primitive may call `Math.random()`. Two reasons, and both are
 * requirements rather than preferences:
 *
 *   1. L2 decides correctness by comparing two state snapshots (D-1). An oracle that
 *      replays the same frames has to get the same state back, or a contract result
 *      means nothing and a nightly failure cannot be reproduced from the event log.
 *   2. A flaky assertion in the primary oracle is indistinguishable from a real
 *      defect, which is the one thing the layer that decides correctness must not be.
 *
 * mulberry32: 32 bits of state, no dependencies, identical output on every platform
 * and Node version — which is what "deterministic in CI" actually requires.
 */

/** A stateful uniform generator over [0, 1). */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a over the parts that identify one mounted instance.
 *
 * Mirrors the intent compiler's id fingerprint deliberately: a seed derived from the
 * request rather than from the clock is what makes a failing frame reproducible.
 */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  const input = parts.join(' ');
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
