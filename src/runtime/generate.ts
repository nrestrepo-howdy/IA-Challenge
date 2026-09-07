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
import type { CandidateGenerator, GenerationRequest, RepairGuidance } from './agents.js';
import { CATALOGUE } from '../intent/catalogue.js';

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

/**
 * How far a repair may move a parameter, as a factor of the value in the brief.
 *
 * A `PrimitiveDirective` carries its parameters but not the schema they validated
 * against, so WS2 cannot re-check a repaired number against its declared range — it can
 * only refuse to stray far from a number that already passed WS4's validation. Four is
 * two repairs of ×2 each, and the loop is bounded at three attempts (AC-19), so that is
 * the entire reach of a repair chain: guidance is always computed against the original
 * brief, never against an already-repaired one, so this ceiling cannot be walked past by
 * applying it twice.
 */
export const REPAIR_BAND = 4;

/**
 * The whole of what a repair is allowed to change.
 *
 * D-2 says the agent composes catalogue primitives rather than inventing, and this
 * function is where that stops being a promise. An adjustment can only re-point a
 * parameter that is already in the brief, at a value of the type it already had,
 * inside `REPAIR_BAND`. It cannot add a directive, add a parameter, change a type, or
 * introduce a line of source — those are not rejected here, they are unrepresentable,
 * because `ParamAdjustment` has nowhere to put them and this function ignores anything
 * that does not match something already present.
 *
 * That matters most for the model-backed agent: `ClaudeRepairAgent` is prompted to
 * return parameters, but nothing downstream *trusts* it to. This is the check.
 */
export function applyGuidance(brief: CodeBrief, guidance: RepairGuidance | null): CodeBrief {
  if (!guidance || guidance.params.length === 0) return brief;
  const directives = brief.directives.map((d) => {
    const mine = guidance.params.filter((p) => p.primitive === d.name);
    if (mine.length === 0) return d;
    const params: Record<string, unknown> = { ...d.params };
    for (const adjustment of mine) {
      const current = params[adjustment.param];
      if (current === undefined) continue;   // a parameter the brief does not have is not a repair
      const next = reconcile(current, adjustment.value);
      if (next !== undefined) params[adjustment.param] = clampToSchema(d.name, adjustment.param, next);
    }
    return { ...d, params };
  });
  return { ...brief, directives };
}

/**
 * Clamps a repaired value to the range the catalogue declares for it.
 *
 * `REPAIR_BAND` bounds how far a repair may move a value *relative to itself*, which
 * is not the same as keeping it legal: `rain-emitter.speed` defaults to 24 against a
 * declared maximum of 80, so two doublings inside the band land at 96 — outside the
 * schema that validated the original. That was a real hole, reported by the workstream
 * that built the repair loop and not patched by it.
 *
 * The catalogue is read here rather than carried on `PrimitiveDirective`, which would
 * have meant amending the frozen contract to transport data that already exists and is
 * already the single source of truth. A repair may re-point a parameter; it may not
 * take it somewhere the primitive never agreed to go.
 */
function clampToSchema(primitive: string, param: string, value: unknown): unknown {
  const spec = CATALOGUE.find((c) => c.name === primitive);
  const declared = (spec?.schema.properties as Record<string, { minimum?: number; maximum?: number }> | undefined)?.[param];
  if (!declared) return value;
  const lo = declared.minimum ?? -Infinity;
  const hi = declared.maximum ?? Infinity;
  const fit = (n: number): number => Math.min(hi, Math.max(lo, n));
  if (typeof value === 'number') return fit(value);
  if (Array.isArray(value)) return value.map((n) => (typeof n === 'number' ? fit(n) : n));
  return value;
}

/** `undefined` for anything that would change a parameter's type or leave the band. */
function reconcile(current: unknown, proposed: number | readonly number[]): unknown {
  if (typeof current === 'number' && typeof proposed === 'number') {
    if (!Number.isFinite(proposed)) return undefined;
    const bounded = clampToBand(current, proposed);
    // An integer parameter stays an integer: `count: 4000.5` is not a particle count,
    // and nothing between here and the primitive would round it.
    return Number.isInteger(current) ? Math.round(bounded) : bounded;
  }
  if (Array.isArray(current) && Array.isArray(proposed) && current.length === proposed.length) {
    if (!current.every((v) => typeof v === 'number') || !proposed.every((v) => Number.isFinite(v))) {
      return undefined;
    }
    // Every array-valued parameter in the catalogue is a unit vector or a unit RGB
    // triple, and the sign of each element is fixed by which of the two it is — a
    // colour channel has no negative half. WS2 cannot read the declared range (see
    // REPAIR_BAND), so it holds each element to the unit interval on the side the
    // original was already on.
    return proposed.map((v, i) => {
      const origin = current[i] as number;
      return Math.max(origin < 0 ? -1 : 0, Math.min(1, v));
    });
  }
  return undefined;
}

function clampToBand(current: number, proposed: number): number {
  if (current === 0) return Math.max(-REPAIR_BAND, Math.min(REPAIR_BAND, proposed));
  const lo = Math.min(current / REPAIR_BAND, current * REPAIR_BAND);
  const hi = Math.max(current / REPAIR_BAND, current * REPAIR_BAND);
  return Math.max(lo, Math.min(hi, proposed));
}

/**
 * The three strategies, reordered so a preferred one leads.
 *
 * Order is not cosmetic: `firstInjectable` takes the first candidate that clears the
 * cascade (D-5), so leading with a different strategy changes which program reaches the
 * world when more than one is acceptable. Names the generator does not know are
 * ignored rather than trusted — the same rule `applyGuidance` applies to parameters.
 */
export function orderStrategies(guidance: RepairGuidance | null): readonly CandidateStrategy[] {
  if (!guidance || guidance.preferStrategies.length === 0) return STRATEGIES;
  const preferred = guidance.preferStrategies
    .map((name) => STRATEGIES.find((s) => s.name === name))
    .filter((s): s is CandidateStrategy => s !== undefined);
  return [...new Set([...preferred, ...STRATEGIES])];
}

/**
 * One candidate per strategy: three genuinely different programs, not three samples (D-5).
 *
 * With guidance, they are also three programs the previous attempt did not produce.
 * `attempt` alone only ever changed the candidate ids, which is why the retry loop was
 * a retry loop: the same three modules, verified against the same oracles, for the same
 * result. The repair is in the brief this reads, not in the templates below it.
 */
export function generateCandidates(
  intent: Intent,
  attempt = 0,
  guidance: RepairGuidance | null = null,
): Candidate[] {
  const brief = applyGuidance(intent.brief, guidance);
  return orderStrategies(guidance).map((s) => ({
    id: `${intent.id}-${s.name}-${attempt}`,
    intentId: intent.id,
    strategy: s.name,
    source: s.emit(brief, attempt),
  }));
}

/**
 * The template generator as a `CandidateGenerator`, so the bounded cycle can drive it.
 *
 * `runCycle` counts attempts from 1 and `generateCandidates` from 0; the offset lives
 * here rather than at either call site, because a candidate id that shifts by one
 * between the two cycles is the kind of thing only a debugging session finds.
 */
export const templateGenerator: CandidateGenerator = {
  async generate(request: GenerationRequest): Promise<readonly Candidate[]> {
    return generateCandidates(request.intent, request.attempt - 1, request.guidance);
  },
};
