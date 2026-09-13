import { describe, it, expect } from 'vitest';
import { deriveSuggestions } from '../../src/app/suggestions.js';
import { CatalogueIntentCompiler } from '../../src/intent/compiler.js';
import { MOODS } from '../../src/intent/moods.js';
import { FIGURES } from '../../src/intent/figures.js';
import type { WorldHandle } from '../../src/contracts.js';
import { CATALOGUE } from '../../src/intent/catalogue.js';

describe('the openers are read out of the catalogue, never written down', () => {
  it('offers a few, and no more', () => {
    expect(deriveSuggestions().length).toBe(3);
    expect(deriveSuggestions(CATALOGUE, 2).length).toBe(2);
  });

  it('follows the catalogue when the catalogue changes', () => {
    const only = deriveSuggestions([CATALOGUE[3]!], 3);
    expect(only.map((s) => s.utterance)).toEqual([`add ${CATALOGUE[3]!.keywords[0]!}`]);
  });

  it('offers nothing when there is nothing to offer', () => {
    expect(deriveSuggestions([], 3)).toEqual([]);
  });

  /**
   * The property that matters: an opener that does not work is worse than no opener,
   * so every one of them is put through the compiler for real.
   *
   * Compiled rather than resolved, and the change is not a loosening. The first version
   * asserted that the resolver returned a *catalogue primitive*, which was true when all
   * three openers came from the catalogue and stopped being the right question once they
   * came from three different surfaces: a rig resolves to no catalogue primitive at all
   * and is a perfectly good answer. What a user clicking a chip is owed is that
   * something happens — a compiled intent with a directive in it — and that is what is
   * checked now, on the offline path, which is the one a judge with no key runs.
   */
  it('every suggestion compiles to something injectable, with no key', async () => {
    const compiler = new CatalogueIntentCompiler({ catalogue: CATALOGUE });
    const world = { state: {}, scene: null, clock: { elapsed: 0 } } as unknown as WorldHandle;
    for (const s of deriveSuggestions(CATALOGUE, CATALOGUE.length)) {
      const out = await compiler.compile(s.utterance, world);
      expect('rejected' in out, `${s.utterance} was rejected`).toBe(false);
      if ('rejected' in out) continue;
      expect(out.brief.directives.length, s.utterance).toBeGreaterThan(0);
      // Nothing in the phrasing goes unaddressed: an opener that ships a disclosure
      // teaches the user the prompt half-listens.
      expect(out.unaddressed, s.utterance).toEqual([]);
    }
  });

  it('offers one opener per surface, so the first impression is the range', () => {
    // The first version took the first three catalogue entries and produced "add rain",
    // "add snow", "add wind" — three ways of saying the same thing, from a system that
    // also composes moods and writes rigs. This is the product describing itself, and
    // it was underselling by a wide margin.
    const [primitive, mood, figure] = deriveSuggestions();
    expect(primitive?.utterance).toBe(`add ${CATALOGUE[0]!.keywords[0]!}`);
    expect(MOODS.some((m) => m.triggers.includes(mood?.utterance ?? ''))).toBe(true);
    expect(FIGURES.some((f) => f.triggers.includes(figure?.utterance ?? ''))).toBe(true);
  });
});
