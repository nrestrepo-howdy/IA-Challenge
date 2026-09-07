/**
 * What each state path currently holds.
 *
 * This existed as an exported `const` inside `src/app/cycle.ts`, which made it a side
 * effect of one workstream that another workstream depended on. Two agents working in
 * parallel found that out the hard way: the one building the repair loop branched
 * before undo existed, saw an exported map its own code did not use, and made it
 * private again — breaking `history.ts` at integration.
 *
 * Frozen contracts prevented every collision between the five workstreams they
 * described, and none at all here, because this boundary was never declared. So it is
 * declared now: shared mutable state gets its own module, its own name, and a reason
 * written down, rather than living as an export from whichever file happened to create
 * it first.
 *
 * The world owns each state path exclusively — a shared path would make every contract
 * over it non-deterministic — so this map is how the previous occupant is found and
 * retired before a new one claims the path.
 */

/** statePath -> the id of the instance currently mounted there. */
const registry = new Map<string, string>();

export function occupantOf(statePath: string): string | undefined {
  return registry.get(statePath);
}

export function claim(statePath: string, instanceId: string): void {
  registry.set(statePath, instanceId);
}

export function release(statePath: string): void {
  registry.delete(statePath);
}

/**
 * Forgets every occupant. Undo calls this: restoring a snapshot invalidates every id
 * in here, and a stale id would make the next injection try to retire an instance that
 * no longer exists.
 */
export function forgetAll(): void {
  registry.clear();
}

/** For tests and diagnostics. Never mutate the result. */
export function occupiedPaths(): readonly string[] {
  return [...registry.keys()];
}
