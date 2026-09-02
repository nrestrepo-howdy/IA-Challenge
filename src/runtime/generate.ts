/**
 * Candidate generation from a brief.
 *
 * Two implementations behind one interface, and the *deterministic* one is not a
 * mock. R-1 measures the state of the art at roughly 28% on open-ended Three.js
 * synthesis, which is why D-2 closed the surface: the agent composes catalogue
 * primitives it has been handed rather than inventing them. Once the brief names
 * primitives that exist and parameters that already validated, emitting the module
 * is a rendering problem, not a reasoning one.
 *
 * That has a consequence worth stating plainly: the whole pipeline -- intent,
 * cascade, injection -- is provable end to end with no API key and no network. The
 * language model earns its place upstream, resolving an utterance into a brief, and
 * a model failure degrades to a rejection rather than to broken code.
 */
import type { Candidate, CodeBrief, Intent } from '../contracts.js';

export interface CandidateStrategy {
  readonly name: string;
  emit(brief: CodeBrief, attempt: number): string;
}

const json = (v: unknown): string => JSON.stringify(v);

/** Mounts every directive in one pass. The obvious composition. */
export const directStrategy: CandidateStrategy = {
  name: 'direct',
  emit(brief) {
    const imports = brief.directives
      .map((d, i) => `import p${i} from ${json(d.importSpecifier)};`)
      .join('\n');
    const mounts = brief.directives
      .map((d, i) => `  mounted.push({ instance: p${i}.mount(world, ${json(d.params)}), statePath: ${json(d.statePath)} });`)
      .join('\n');
    return `${imports}

// ${brief.goal}
// ${brief.rationale}
export function mount(world) {
  const mounted = [];
${mounts}
  return mounted;
}
`;
  },
};

/**
 * Mounts defensively: a directive that throws does not take the others with it.
 * A partial world beats no world when the failure is in one primitive, and the
 * contract still decides whether what survived is acceptable.
 */
export const resilientStrategy: CandidateStrategy = {
  name: 'resilient',
  emit(brief) {
    const imports = brief.directives
      .map((d, i) => `import p${i} from ${json(d.importSpecifier)};`)
      .join('\n');
    const mounts = brief.directives
      .map((d, i) => `  try {
    mounted.push({ instance: p${i}.mount(world, ${json(d.params)}), statePath: ${json(d.statePath)} });
  } catch (err) { failed.push([${json(d.name)}, String(err)]); }`)
      .join('\n');
    return `${imports}

// ${brief.goal} (resilient)
export function mount(world) {
  const mounted = [], failed = [];
${mounts}
  if (mounted.length === 0) throw new Error('every directive failed: ' + JSON.stringify(failed));
  return mounted;
}
`;
  },
};

/**
 * Mounts in reverse order. Not a cosmetic variation: registration order decides tick
 * order, and a primitive that reads another's slice sees a different world depending
 * on which mounted first. When the other two disagree with the contract, this is the
 * one that reveals an ordering assumption nobody wrote down.
 */
export const reversedStrategy: CandidateStrategy = {
  name: 'reversed',
  emit(brief) {
    return directStrategy.emit({ ...brief, directives: [...brief.directives].reverse() }, 0);
  },
};

export const STRATEGIES: readonly CandidateStrategy[] = [directStrategy, resilientStrategy, reversedStrategy];

/** One candidate per strategy: three genuinely different programs, not three samples (D-5). */
export function generateCandidates(intent: Intent, attempt = 0): Candidate[] {
  return STRATEGIES.map((s) => ({
    id: `${intent.id}-${s.name}-${attempt}`,
    intentId: intent.id,
    strategy: s.name,
    source: s.emit(intent.brief, attempt),
  }));
}
