import { describe, expect, it } from 'vitest';
import type { Intent, IntentRejection } from '../../src/contracts.js';
import { CATALOGUE } from '../../src/intent/catalogue.js';
import { CatalogueIntentCompiler, isRejection, type CompiledIntent } from '../../src/intent/compiler.js';
import { keywordModel } from '../../src/intent/model.js';
import { failingModel, fakeWorld, stubModel } from './support.js';

const world = fakeWorld({ weather: {}, lighting: { ambient: { intensity: 1 } } });

function expectIntent(r: CompiledIntent | IntentRejection): CompiledIntent {
  if (isRejection(r)) throw new Error(`expected an intent, got a rejection: ${r.reason}`);
  return r;
}

function expectRejection(r: CompiledIntent | IntentRejection): IntentRejection {
  if (!isRejection(r)) throw new Error(`expected a rejection, got intent ${r.id}`);
  return r;
}

describe('AC-16 · every intent produces a (code, contract) pair', () => {
  it('compiles "make it rain" into a brief and a contract together', async () => {
    const compiler = new CatalogueIntentCompiler({ model: keywordModel });
    const intent = expectIntent(await compiler.compile('make it rain', world));

    expect(intent.brief.directives.map((d) => d.name)).toEqual(['rain-emitter']);
    expect(intent.brief.directives[0]?.importSpecifier).toBe('verbo:rain-emitter');
    expect(intent.contract.assertions.length).toBeGreaterThan(0);
    expect(intent.contract.mutants.length).toBeGreaterThan(0);
    // The declared write scope is what L0's out-of-scope check is checked against.
    expect(intent.scope).toEqual(['weather.rain']);
    expect(intent.allowedPrimitives).toEqual(['rain-emitter']);
  });

  it('carries a contract for every primitive in the closed catalogue', async () => {
    for (const spec of CATALOGUE) {
      const compiler = new CatalogueIntentCompiler({ model: stubModel({ primitives: [{ name: spec.name }] }) });
      const intent = expectIntent(await compiler.compile(`use ${spec.name}`, world));

      expect(intent.contract.assertions.length).toBeGreaterThan(0);
      expect(intent.brief.directives).toHaveLength(1);
      expect(intent.scope).toEqual([spec.statePath]);
      // Every assertion addresses the slice the intent is allowed to write.
      for (const a of intent.contract.assertions) expect(a.path.startsWith(spec.statePath)).toBe(true);
    }
  });

  it('composes several primitives into one intent, contract included', async () => {
    const compiler = new CatalogueIntentCompiler({ model: keywordModel });
    const intent = expectIntent(await compiler.compile('make it storm', world));

    expect(intent.allowedPrimitives).toEqual(expect.arrayContaining(['rain-emitter', 'wind-field']));
    expect(intent.scope).toEqual(expect.arrayContaining(['weather.rain', 'forces.wind']));
    const paths = new Set(intent.contract.assertions.map((a) => a.path));
    expect([...paths].some((p) => p.startsWith('weather.rain'))).toBe(true);
    expect([...paths].some((p) => p.startsWith('forces.wind'))).toBe(true);
  });

  it('makes code-without-a-contract unrepresentable, not merely untested (AC-16)', () => {
    // Structural, per the task: this is a typecheck assertion, and `npm run typecheck`
    // fails if the contract ever becomes optional on Intent.
    // @ts-expect-error — a brief with no contract is not a CompiledIntent.
    const withoutContract: CompiledIntent = {
      id: 'i-1',
      utterance: 'make it rain',
      allowedPrimitives: ['rain-emitter'],
      scope: ['weather.rain'],
      brief: { goal: '', rationale: '', directives: [], steps: [], constraints: [] },
    };
    expect(withoutContract).toBeTruthy();

    const asIntent: Intent = expectTypeIsAssignable();
    expect(asIntent.contract).toBeDefined();
  });

  it('gives the same utterance the same intent id, so a failure is reproducible', async () => {
    const compiler = new CatalogueIntentCompiler({ model: keywordModel });
    const a = expectIntent(await compiler.compile('make it rain', world));
    const b = expectIntent(await compiler.compile('make it rain', world));
    expect(a.id).toBe(b.id);
    expect(a.contract.id).toBe(b.contract.id);
  });
});

describe('AC-17 · an impossible intent is explained, never silently attempted', () => {
  it('rejects a primitive outside the catalogue and suggests the nearest one', async () => {
    const compiler = new CatalogueIntentCompiler({
      model: stubModel({ primitives: [{ name: 'drain-emitter' }] }),
    });
    const r = expectRejection(await compiler.compile('make it drain', world));

    expect(r.reason).toContain("'drain-emitter' is not a primitive in the catalogue");
    expect(r.reason).toContain('rain-emitter');
    expect(r.suggestion).toBe("did you mean 'rain-emitter'?");
  });

  it('suggests a primitive for a typo, and nothing for a rhyme', async () => {
    // Edit distance is inflated by shared suffixes, and a suggestion built on one is
    // nonsense. "talking" and "falling" differ in two characters out of seven — score
    // 0.71, over a bar of 0.7 — so "a talking dragon" was answered with "the closest
    // thing the catalogue can do is debris". It surfaced only when the catalogue grew:
    // more keywords, more chances at a spurious near-match, and nothing watching the
    // quality of the suggestion as the vocabulary expanded.
    //
    // Both halves are asserted, because the cheap way to stop suggesting nonsense is to
    // stop suggesting anything.
    const compiler = new CatalogueIntentCompiler({ model: keywordModel });
    const rhyme = expectRejection(await compiler.compile('give the world a talking dragon', world));
    expect(rhyme.suggestion).toBeNull();

    const typo = expectRejection(await compiler.compile('make it raning', world));
    expect(typo.suggestion).toContain('rain-emitter');
  });

  it('rejects a request the catalogue cannot express, with no invented suggestion', async () => {
    const compiler = new CatalogueIntentCompiler({ model: keywordModel });
    const r = expectRejection(await compiler.compile('give the world a talking dragon', world));

    // Asserts the *shape* of a good refusal, not its wording: it quotes what was
    // asked, it says the world cannot do it, and it names things it can — so someone
    // who was refused knows what to type next. The first version listed internal
    // primitive names, which satisfied a weaker version of this test and taught a user
    // nothing.
    expect(r.reason).toContain('give the world a talking dragon');
    expect(r.reason).toMatch(/can't do|cannot/);
    expect(r.reason).toMatch(/\bTry:/);
    expect(r.reason).not.toMatch(/-emitter|-volume|-modulator|-field/);
    // A wrong suggestion costs the user a whole verification cycle, so none is offered.
    expect(r.suggestion).toBeNull();
  });

  it('rejects out-of-range parameters and suggests a value that would be accepted', async () => {
    const compiler = new CatalogueIntentCompiler({
      model: stubModel({ primitives: [{ name: 'rain-emitter', params: { count: 5_000_000 } }] }),
    });
    const r = expectRejection(await compiler.compile('make it rain very hard', world));

    expect(r.reason).toContain('outside [100, 20000]');
    expect(r.suggestion).toBe('use count = 20000');
  });

  it('rejects a parameter that is not part of the primitive surface', async () => {
    const compiler = new CatalogueIntentCompiler({
      model: stubModel({ primitives: [{ name: 'rain-emitter', params: { wetness: 3 } }] }),
    });
    const r = expectRejection(await compiler.compile('make it rain wetly', world));
    expect(r.reason).toContain("'wetness' is not a parameter");
  });

  it('rejects malformed model output instead of guessing at it', async () => {
    const compiler = new CatalogueIntentCompiler({ model: stubModel('sure! I will make it rain') });
    const r = expectRejection(await compiler.compile('make it rain', world));
    expect(r.reason).toContain('not JSON');
    expect(r.suggestion).toBe('rephrase the request');
  });

  it('reports a model failure rather than falling back to an attempt', async () => {
    const compiler = new CatalogueIntentCompiler({ model: failingModel('429 rate limited') });
    const r = expectRejection(await compiler.compile('make it rain', world));
    expect(r.reason).toContain('429 rate limited');
  });

  it('rejects an empty utterance', async () => {
    const compiler = new CatalogueIntentCompiler({ model: keywordModel });
    const r = expectRejection(await compiler.compile('   ', world));
    expect(r.reason).toContain('nothing to resolve');
    expect(r.suggestion).toContain('rain');
  });

  it('never returns a rejection without a reason (AC-17)', async () => {
    const compiler = new CatalogueIntentCompiler({ model: stubModel({ primitives: [{ name: 'unicorn' }] }) });
    const r = expectRejection(await compiler.compile('summon a unicorn', world));
    expect(r.rejected).toBe(true);
    expect(r.reason.length).toBeGreaterThan(20);
  });
});

/** Exists only to assert, at compile time, that a CompiledIntent *is* an Intent. */
function expectTypeIsAssignable(): CompiledIntent {
  return {
    id: 'i-2',
    utterance: 'make it rain',
    allowedPrimitives: ['rain-emitter'],
    scope: ['weather.rain'],
    contract: { id: 'c-2', assertions: [], actions: [], mutants: [] },
    unaddressed: [],
    brief: { goal: 'make it rain', rationale: '', directives: [], steps: [], constraints: [] },
  };
}

/**
 * The night-one evaluation finding, now a test.
 *
 * "make it rain money" resolved to rain and dropped "money", and success was reported
 * for something the system did not do. The decision was to accept and disclose rather
 * than reject: the world genuinely can rain, and refusing a request it can partly
 * satisfy is worse service. What is not acceptable is delivering the subset silently.
 */
describe('partial fulfilment is disclosed, never silent', () => {
  it('carries what the catalogue could not express onto the intent', async () => {
    const compiler = new CatalogueIntentCompiler({
      model: {
        propose: async () =>
          JSON.stringify({
            primitives: [{ name: 'rain-emitter', params: {} }],
            rationale: 'matched rain',
            unaddressed: ['money'],
          }),
      },
    });
    const r = await compiler.compile('make it rain money', fakeWorld());
    if (isRejection(r)) throw new Error(`expected acceptance, got: ${r.reason}`);
    expect(r.unaddressed).toEqual(['money']);
    // Also in the brief's prose, so it survives into logs and world snapshots.
    expect(r.brief.rationale).toContain('money');
  });

  it('is empty when the request was fully expressible', async () => {
    const compiler = new CatalogueIntentCompiler({
      model: {
        propose: async () =>
          JSON.stringify({ primitives: [{ name: 'rain-emitter', params: {} }], rationale: 'ok' }),
      },
    });
    const r = await compiler.compile('make it rain', fakeWorld());
    if (isRejection(r)) throw new Error('expected acceptance');
    expect(r.unaddressed).toEqual([]);
  });
});

/**
 * The offline resolver used to select a primitive and leave every parameter at its
 * default, so "make it night" and "sunset" both resolved to noon — daylight's default.
 * The primitive ran, the contract passed, and the user got the opposite of what they
 * asked for: success reported for the wrong thing.
 */
describe('the offline resolver honours words that pin a parameter', () => {
  const compiler = new CatalogueIntentCompiler({ model: keywordModel });

  it.each([
    ['make it night', 0],
    ['make it day', 0.5],
    ['sunset', 0.75],
    ['dawn', 0.25],
  ])('resolves %s to phase %s', async (utterance, phase) => {
    const r = await compiler.compile(utterance, fakeWorld());
    if (isRejection(r)) throw new Error(`expected acceptance, got: ${r.reason}`);
    const daylight = r.brief.directives.find((d) => d.name === 'daylight');
    expect(daylight?.params['phase']).toBe(phase);
  });

  it('leaves the default alone when no word pins it', async () => {
    const r = await compiler.compile('change the light', fakeWorld());
    if (isRejection(r)) return;   // resolving to something else is fine; guessing is not
    const daylight = r.brief.directives.find((d) => d.name === 'daylight');
    if (daylight) expect(daylight.params['phase']).toBe(0.5);
  });
});
