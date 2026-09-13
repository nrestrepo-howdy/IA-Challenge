/**
 * WS4 · The intent compiler.
 *
 * Turns an utterance into either a (brief, contract) pair or an explained rejection.
 * The shape of this module follows directly from R-1: because free-form Three.js
 * generation is behaviourally correct roughly 28% of the time, the compiler never asks
 * for free-form code. It resolves the utterance against a closed catalogue (D-2),
 * validates the parameters, synthesises the oracle deterministically, and proves the
 * oracle sound by mutation before anyone writes a line of code.
 *
 * Two acceptance criteria live here:
 *
 *   AC-16 — every intent carries a contract. This is enforced by the type, not by
 *           discipline: `CompiledIntent` extends `Intent`, whose `contract` is
 *           required, and `compileIntent()` below is the only way to build one. There
 *           is no type in this workstream that carries a brief without a contract, so
 *           "code without a contract" is not a thing that can be represented.
 *
 *   AC-17 — an impossible request is rejected with a reason and, where one exists, a
 *           suggestion. Silence and best-effort attempts are both failures: a request
 *           the catalogue cannot express must say so before 40 seconds of verification
 *           budget (R-8) is spent proving it.
 */
import type { Intent, IntentCompiler, IntentRejection, StateContract, WorldHandle } from '../contracts.js';
import { hardenContract } from '../harness/mutation.js';
import { CATALOGUE, findPrimitive, type PrimitiveSpec } from './catalogue.js';
import { buildContract, buildWitness, type Selection } from './contract.js';
import { toTranslatedVocabulary } from './es.js';
import { matchFigure, type FigureSpec } from './figures.js';
import { keywordModel, parseProposal, type LanguageModel, type ModelRequest } from './model.js';
import { validateParams } from './schema.js';

/** One composition step: which primitive, imported how, parameterized with what. */
export interface PrimitiveDirective {
  readonly name: string;
  /** L0 only admits `verbo:*` specifiers that are in `allowedPrimitives`. */
  readonly importSpecifier: string;
  readonly statePath: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * The code-generation half of an intent. It is a brief, not a prompt: it names
 * primitives that exist and parameters that validated, so the generator composes
 * rather than invents.
 */
export interface CodeBrief {
  readonly goal: string;
  readonly rationale: string;
  readonly directives: readonly PrimitiveDirective[];
  readonly steps: readonly string[];
  readonly constraints: readonly string[];
}

/** An `Intent` (contract required) plus its brief. Neither half exists alone (AC-16). */
export interface CompiledIntent extends Intent {
  readonly brief: CodeBrief;
  /**
   * Quoted fragments the catalogue could not express. A machine-checkable field, not
   * only prose in the rationale: a disclosure the caller cannot test for is a
   * disclosure the caller will forget to make.
   */
  readonly unaddressed: readonly string[];
}

export function isRejection(r: CompiledIntent | IntentRejection): r is IntentRejection {
  return (r as IntentRejection).rejected === true;
}

export interface CompilerOptions {
  readonly model?: LanguageModel;
  /** Injectable so a test can prove an unsound catalogue entry is refused, not shipped. */
  readonly catalogue?: readonly PrimitiveSpec[];
}

export class CatalogueIntentCompiler implements IntentCompiler {
  private readonly model: LanguageModel;
  private readonly catalogue: readonly PrimitiveSpec[];

  constructor(options: CompilerOptions = {}) {
    this.model = options.model ?? keywordModel;
    this.catalogue = options.catalogue ?? CATALOGUE;
  }

  async compile(utterance: string, world: WorldHandle): Promise<CompiledIntent | IntentRejection> {
    const goal = utterance.trim();
    if (goal.length === 0) {
      return reject('the utterance is empty, so there is nothing to resolve', exampleUtterance(this.catalogue));
    }

    const request: ModelRequest = {
      utterance: goal,
      catalogue: this.catalogue,
      worldPaths: statePaths(world.state),
    };

    let raw: string;
    try {
      raw = await this.model.propose(request);
    } catch (err) {
      // A model failure is reported, never papered over with a guess: guessing is the
      // behaviour AC-17 exists to forbid.
      return reject(`the model could not be reached: ${(err as Error).message}`, 'retry the request');
    }

    const parsed = parseProposal(raw);
    if (!parsed.ok) return reject(parsed.error, 'rephrase the request');

    // The freeform path, before the refusal.
    //
    // A closed catalogue of weather and light answers "un perro con una persona
    // paseando" with "cannot express", which is honest and is also the product
    // admitting it is a lighting desk rather than a world. `figure` is the way out: a
    // rig of typed shapes and a pose function, verified by the same four layers as
    // everything else. It is added *alongside* whatever the catalogue matched, so "a
    // dog in the rain" is one world and not a choice between two.
    const figure = matchFigure(toTranslatedVocabulary(goal));

    if (parsed.proposal.primitives.length === 0 && !figure) {
      return reject(
        // Written for a person, not for a developer. The first version listed internal
        // primitive names — "rain-emitter, orbit-modulator" — which is accurate and
        // useless: nobody types "orbit-modulator", and a refusal nobody can act on
        // teaches them the world is broken rather than that it is finite.
        `this world can't do "${goal}" — it knows weather, light and time of day, water, ` +
        `and the shape of the city. Try: rain, snow, fog, wind, a storm, lightning, ` +
        `day or night, dawn or dusk, water, a tower, taller buildings, a different ground, ` +
        `aurora, birds, searchlights.`,
        nearestByKeyword(this.catalogue, goal),
      );
    }

    // Resolve against the closed set. This is the check that makes the catalogue closed
    // in fact and not just in the prompt (D-2).
    const selections: Selection[] = [];
    const seen = new Set<string>();
    for (const proposed of parsed.proposal.primitives) {
      if (seen.has(proposed.name)) continue;
      seen.add(proposed.name);

      const spec = findPrimitive(this.catalogue, proposed.name);
      if (!spec) {
        return reject(
          `'${proposed.name}' is not a primitive in the catalogue, and the agent may not invent one. Available: ${names(this.catalogue).join(', ')}`,
          nearestByName(this.catalogue, proposed.name),
        );
      }

      const { params, violations } = validateParams(spec.schema, spec.defaults, proposed.params ?? {});
      const violation = violations[0];
      if (violation) {
        const repair = violations.find((v) => v.repair !== null);
        return reject(
          `'${spec.name}' cannot be parameterized as asked: ${violations.map((v) => v.detail).join('; ')}`,
          repair ? `use ${repair.param} = ${JSON.stringify(repair.repair)}` : null,
        );
      }
      selections.push({ spec, params });
    }

    // Last, so the rig ticks after the weather it walks through.
    if (figure) selections.push(figureSelection(figure));

    const key = fingerprint(goal + '|' + selections.map((s) => s.spec.name).join(','));
    const contract = buildContract(`contract-${key}`, selections);

    // The contract is proved before it is emitted (§4.3, AC-10). A contract that cannot
    // catch its own mutants would make L2 — the layer that decides correctness — a
    // rubber stamp, so an unsound one is refused rather than shipped and discovered later.
    const witness = buildWitness(selections);
    const hardening = hardenContract(contract, witness.before, witness.after);
    if (!hardening.hardened) {
      return reject(
        `a sound state contract could not be generated for "${goal}": ${hardening.reason}`,
        'narrow the request to a single primitive',
      );
    }

    // The night-one evaluation finding, decided.
    //
    // "make it rain money" resolves to rain and drops "money". Rejecting outright is
    // wrong -- the world genuinely can rain, and refusing a request it can partly
    // satisfy is worse service than the alternative. Accepting silently is what the
    // rules call an agent claiming work is complete without verification.
    //
    // So: accept, and disclose. The unmet part travels with the intent and is stated
    // to the user. The one case that still rejects is a request where nothing at all
    // was addressed, which `selections.length === 0` above already covers.
    // A rig answers for the words that selected it. The resolver reported "dog" as
    // beyond the catalogue — which was true of the catalogue and is no longer true of
    // the world — and leaving it in `unaddressed` would tell the user the thing walking
    // across the frame is not there.
    const unaddressed = (parsed.proposal.unaddressed ?? []).filter((u) => {
      if (!figure) return true;
      const said = u.toLowerCase();
      const claimed = [...figure.triggers, ...(figure.covers ?? [])];
      return !claimed.some((word) => said.includes(word) || word.includes(said));
    });
    return compileIntent({
      id: `intent-${key}`,
      utterance: goal,
      selections,
      contract,
      rationale: parsed.proposal.rationale ?? 'resolved against the primitive catalogue',
      unaddressed,
    });
  }
}

/**
 * The only constructor of a `CompiledIntent`, and it takes the contract as a required
 * argument (AC-16). Nothing downstream can be handed a brief that has no oracle
 * attached, because there is no code path that produces one.
 */
function compileIntent(input: {
  id: string;
  utterance: string;
  selections: readonly Selection[];
  contract: StateContract;
  rationale: string;
  /** Quoted fragments the catalogue could not express. Empty is the common case. */
  unaddressed?: readonly string[];
}): CompiledIntent {
  const directives = input.selections.map((s) => ({
    name: s.spec.name,
    importSpecifier: `verbo:${s.spec.name}`,
    statePath: s.spec.statePath,
    params: s.params,
  }));

  const unmet = input.unaddressed ?? [];
  const brief: CodeBrief = {
    goal: input.utterance,
    // The disclosure travels inside the brief, so it survives into the world snapshot
    // and into any log that records what was actually built.
    rationale: unmet.length
      ? `${input.rationale}. Not expressible by the catalogue: ${unmet.map((u) => `"${u}"`).join(', ')}`
      : input.rationale,
    directives,
    steps: [
      ...directives.map(
        (d) => `import { ${camel(d.name)} } from '${d.importSpecifier}' and mount it with ${JSON.stringify(d.params)}`,
      ),
      `register each instance at its declared statePath so L2 can observe it`,
      `update __VERBO_STATE__ every frame for: ${animatedPaths(input.contract).join(', ') || '(nothing animated)'}`,
      `dispose() every instance created, unconditionally`,
    ],
    constraints: [
      'compose catalogue primitives only; do not write raw Three.js or invent a primitive (D-2)',
      `write only inside [${input.selections.map((s) => s.spec.statePath).join(', ')}] (AC-05)`,
      'no network, no DOM, no dynamic evaluation — the module runs in a Worker',
      'dispose() is mandatory: the blob-URL module itself can never be freed (R-4)',
    ],
  };

  return {
    unaddressed: unmet,
    id: input.id,
    utterance: input.utterance,
    allowedPrimitives: input.selections.map((s) => s.spec.name),
    // The declared write scope, which is what L0's out-of-scope check is checked against.
    scope: input.selections.map((s) => s.spec.statePath),
    contract: input.contract,
    brief,
  };
}

/**
 * A rig, as a `Selection` the rest of the compiler already knows how to handle.
 *
 * The spec is built here rather than kept in the catalogue, and the difference is the
 * whole design: `CATALOGUE` is the closed set the *resolver* may compose from, and
 * putting `figure` in it would let the model answer "make it rain" with a rig. This
 * spec exists for the length of one compile, for one named figure, so the contract and
 * the witness machinery can treat it like anything else.
 *
 * The three fields are the ones worth asserting over. `count` pins the rig to the one
 * that was asked for; `pose` is the animated field, which is the assertion that catches
 * the dominant failure — a figure that is present and inert, standing in the plaza in a
 * T-pose; `instance` is the resource witness, the only way a nulled `dispose()` becomes
 * visible to L2 at all (R-4).
 */
function figureSelection(figure: FigureSpec): Selection {
  const spec: PrimitiveSpec = {
    name: 'figure',
    summary: `a rig of shapes with a generated pose: ${figure.rationale}`,
    statePath: `figures.${figure.name}`,
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    defaults: {},
    keywords: [],
    fields: [
      { key: 'count', role: 'constant', fromParam: 'count' },
      // Two poses that differ, which is all `changesOverTime` needs of a witness: it
      // proves the contract *can* tell a moving rig from a still one before the
      // contract is ever pointed at a real candidate.
      {
        key: 'pose',
        role: 'animated',
        witness: [
          [0, 0, 0, 0, 0, 0, 1],
          [0, 1, 0, 0, 0, 0, 1],
        ],
      },
      { key: 'instance', role: 'resource', witness: 'figure#0' },
    ],
  };
  return {
    spec,
    params: {
      name: figure.name,
      origin: [...figure.origin],
      parts: figure.parts.map((p) => ({
        id: p.id, shape: p.shape,
        size: [...p.size], color: [...p.color],
        emissive: p.emissive ?? 0,
      })),
      poseSource: figure.pose,
      count: figure.parts.length,
    },
  };
}

function reject(reason: string, suggestion: string | null): IntentRejection {
  return { rejected: true, reason, suggestion };
}

function names(catalogue: readonly PrimitiveSpec[]): readonly string[] {
  return catalogue.map((p) => p.name);
}

function animatedPaths(contract: StateContract): readonly string[] {
  return contract.assertions.filter((a) => a.kind === 'changesOverTime').map((a) => a.path);
}

/** Top-level and second-level paths of the live world. Read-only: WS4 never mutates it. */
function statePaths(state: Readonly<Record<string, unknown>>): readonly string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(state)) {
    out.push(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const inner of Object.keys(v as Record<string, unknown>)) out.push(`${k}.${inner}`);
    }
  }
  return out;
}

/** "Did you mean" for a name outside the catalogue. Null when nothing is close enough. */
function nearestByName(catalogue: readonly PrimitiveSpec[], proposed: string): string | null {
  let best: { name: string; score: number } | null = null;
  for (const p of catalogue) {
    const score = similarity(proposed.toLowerCase(), p.name);
    if (!best || score > best.score) best = { name: p.name, score };
  }
  return best && best.score >= 0.5 ? `did you mean '${best.name}'?` : null;
}

/** Same idea against the utterance's own words, for a request that resolved to nothing. */
function nearestByKeyword(catalogue: readonly PrimitiveSpec[], utterance: string): string | null {
  const words = utterance.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: { spec: PrimitiveSpec; score: number } | null = null;
  for (const spec of catalogue) {
    for (const keyword of spec.keywords) {
      for (const word of words) {
        const score = similarity(word, keyword);
        if (!best || score > best.score) best = { spec, score };
      }
    }
  }
  // A high bar on purpose: a wrong suggestion is worse than none, because it sends the
  // user back through a 40 s cycle for something the catalogue was never going to do.
  return best && best.score >= 0.7
    ? `the closest thing the catalogue can do is '${best.spec.name}' — ${best.spec.summary}`
    : null;
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - editDistance(a, b) / max;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * FNV-1a. Ids are a function of the request, never of the clock or a random source:
 * the same utterance compiles to the same intent id, which is what makes a failure
 * reproducible from the event log alone.
 */
function fingerprint(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function exampleUtterance(catalogue: readonly PrimitiveSpec[]): string | null {
  const first = catalogue[0];
  return first ? `try something the catalogue covers, e.g. '${first.keywords[0] ?? first.name}'` : null;
}
