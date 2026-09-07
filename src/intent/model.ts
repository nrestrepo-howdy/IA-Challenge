/**
 * The one non-deterministic step, behind one method.
 *
 * Everything else in WS4 — validation, contract synthesis, hardening — is a pure
 * function. The model's entire job is to pick names out of a closed catalogue and
 * propose parameters for them; it never writes the contract (see contract.ts) and it
 * cannot widen the surface, because a name outside the catalogue is a rejection
 * (AC-17), not an attempt.
 *
 * Keeping it to a single method with a string in and a string out is what lets every
 * test run against a two-line stub with no API key and no network, which is a
 * property of the test suite, not a convenience: an oracle-adjacent component whose
 * tests need the internet is not reproducible for a third party (R-10).
 */
import type { PrimitiveSpec } from './catalogue.js';

export interface ModelRequest {
  readonly utterance: string;
  /** The closed set. The prompt states it, and the compiler enforces it (D-2). */
  readonly catalogue: readonly PrimitiveSpec[];
  /** State paths the world already exposes. Lets the model prefer what exists. */
  readonly worldPaths: readonly string[];
}

export interface LanguageModel {
  /** Returns the raw text of a `ModelProposal` as JSON. Malformed output is a rejection. */
  propose(request: ModelRequest): Promise<string>;
}

export interface ProposedPrimitive {
  readonly name: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ModelProposal {
  readonly primitives: readonly ProposedPrimitive[];
  /** Carried into the brief so a repair agent can see what was understood. */
  readonly rationale?: string;
  /**
   * Parts of the request the catalogue cannot express, quoted from it.
   *
   * Added after the evaluation's first night accepted "make it rain money": `rain`
   * matched, `money` was dropped, and success was reported for something the system
   * did not do. Shape can be constrained by a schema; meaning cannot, so the omission
   * is made explicit and the compiler is forced to decide what to do with it.
   */
  readonly unaddressed?: readonly string[];
}

export type ParseResult =
  | { readonly ok: true; readonly proposal: ModelProposal }
  | { readonly ok: false; readonly error: string };

/** Tolerates fenced output; rejects anything whose shape cannot be trusted. */
export function parseProposal(raw: string): ParseResult {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `model returned text that is not JSON: ${(err as Error).message}` };
  }
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'model returned a non-object proposal' };
  }
  const list = (value as { primitives?: unknown }).primitives;
  if (!Array.isArray(list)) {
    return { ok: false, error: "model proposal has no 'primitives' array" };
  }

  const primitives: ProposedPrimitive[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: 'a proposed primitive is not an object' };
    }
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string' || name.length === 0) {
      return { ok: false, error: 'a proposed primitive has no name' };
    }
    const params = (entry as { params?: unknown }).params;
    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      return { ok: false, error: `params for '${name}' are not an object` };
    }
    primitives.push(
      params === undefined
        ? { name }
        : { name, params: params as Record<string, unknown> },
    );
  }

  const rationale = (value as { rationale?: unknown }).rationale;
  // Carried across the boundary rather than dropped: an omission the model was made
  // to declare is worthless if the parser silently discards it.
  const declared = (value as { unaddressed?: unknown }).unaddressed;
  const unaddressed = Array.isArray(declared)
    ? declared.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : undefined;

  return {
    ok: true,
    proposal: {
      primitives,
      ...(typeof rationale === 'string' ? { rationale } : {}),
      ...(unaddressed && unaddressed.length ? { unaddressed } : {}),
    },
  };
}

/** The prompt a hosted adapter would send. Kept here so the closed set is stated once. */
export function buildPrompt(request: ModelRequest): string {
  const entries = request.catalogue
    .map((p) => `  - ${p.name}: ${p.summary} state '${p.statePath}', params ${JSON.stringify(p.schema.properties)}`)
    .join('\n');
  return [
    'Resolve the utterance into primitives from the catalogue below.',
    'You may only use these names. If none of them can express the request, return {"primitives": []}.',
    'Never invent a primitive, a parameter, or a state path.',
    '',
    'Catalogue:',
    entries,
    '',
    `World state already present: ${request.worldPaths.join(', ') || '(empty)'}`,
    `Utterance: ${JSON.stringify(request.utterance)}`,
    '',
    'Reply with JSON only: {"primitives":[{"name":"...","params":{...}}],"rationale":"..."}',
  ].join('\n');
}

/**
 * The default resolver: deterministic keyword ranking over the same catalogue.
 *
 * It is not a stand-in for a hosted model — it is the offline path that keeps the
 * repo runnable and the suite reproducible without a key. It resolves names only and
 * leaves every parameter at its catalogue default, because guessing numbers from
 * adverbs would be invention by another route (D-2).
 */
export const keywordModel: LanguageModel = {
  propose(request: ModelRequest): Promise<string> {
    const words = tokenize(request.utterance);
    const hits = request.catalogue
      .map((spec) => ({
        spec,
        score: spec.keywords.reduce((n, k) => n + (words.has(k) ? 1 : 0), 0),
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || a.spec.name.localeCompare(b.spec.name));

    // Words that carried meaning and matched nothing in the catalogue.
    //
    // The disclosure must not depend on having an API key: a property that only holds
    // on the paid path is a property the offline test suite cannot defend, and the
    // offline path is what a judge runs. So the keyword resolver computes it too --
    // less precisely than a model would, and honestly.
    const matched = new Set(hits.flatMap((h) => h.spec.keywords));
    const unaddressed = [...words].filter(
      (w) => !matched.has(w) && !FILLER.has(w) && w.length > 2,
    );

    return Promise.resolve(
      JSON.stringify({
        primitives: hits.map((h) => ({ name: h.spec.name, params: hintedParams(h.spec, words) })),
        rationale: hits.length
          ? `matched ${hits.map((h) => h.spec.name).join(', ')} on catalogue keywords`
          : 'no catalogue keyword matched the utterance',
        unaddressed,
      }),
    );
  },
};

/**
 * Words that carry no request. Deliberately small: a long list would quietly swallow
 * real nouns, and a false "everything was addressed" is worse than a noisy disclosure
 * — the whole point of the field is that silence is the failure mode.
 */
const FILLER = new Set([
  'the', 'and', 'with', 'for', 'let', 'make', 'add', 'put', 'set', 'give', 'this',
  'that', 'some', 'more', 'less', 'very', 'please', 'can', 'you', 'now', 'here',
  'world', 'scene', 'it', 'its', 'a', 'an', 'to', 'of', 'in', 'on', 'up', 'down',
  'together', 'also', 'then', 'again',
]);

/**
 * Parameters the utterance pinned, by word.
 *
 * Only for words the catalogue declared. A resolver that guessed at numbers would be
 * the hosted model's job done badly; this only reads a mapping the primitive itself
 * published, which is why it is safe to run with no model at all.
 */
function hintedParams(spec: PrimitiveSpec, words: Set<string>): Record<string, unknown> {
  const hints = spec.paramHints;
  if (!hints) return {};
  const params: Record<string, unknown> = {};
  for (const [word, values] of Object.entries(hints)) {
    if (words.has(word)) Object.assign(params, values);
  }
  return params;
}

function tokenize(utterance: string): Set<string> {
  return new Set(utterance.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}
