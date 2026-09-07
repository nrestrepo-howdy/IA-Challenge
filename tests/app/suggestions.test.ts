import { describe, it, expect } from 'vitest';
import { deriveSuggestions } from '../../src/app/suggestions.js';
import { CATALOGUE } from '../../src/intent/catalogue.js';
import { keywordModel } from '../../src/intent/model.js';

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
   * The property that matters: a suggestion for a primitive the resolver cannot reach
   * is worse than no suggestion, so every one of them is resolved for real.
   */
  it('every suggestion resolves to a primitive that exists', async () => {
    for (const s of deriveSuggestions(CATALOGUE, CATALOGUE.length)) {
      const raw = await keywordModel.propose({
        utterance: s.utterance, catalogue: CATALOGUE, worldPaths: [],
      });
      const proposal = JSON.parse(raw) as {
        primitives: { name: string }[];
        unaddressed: string[];
      };
      expect(proposal.primitives.length, s.utterance).toBeGreaterThan(0);
      expect(CATALOGUE.map((p) => p.name)).toContain(proposal.primitives[0]!.name);
      // Nothing in the phrasing goes unaddressed: an opener that ships a disclosure
      // teaches the user the prompt half-listens.
      expect(proposal.unaddressed, s.utterance).toEqual([]);
    }
  });
});
