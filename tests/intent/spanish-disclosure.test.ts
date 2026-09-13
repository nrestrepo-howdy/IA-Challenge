/**
 * A Spanish utterance must not disclose its own Spanish.
 *
 * `toCatalogueVocabulary` keeps the original text alongside the translation, so that
 * matching sees both — an English keyword the lexicon would never have touched survives
 * next to a translated Spanish one. That is right for searching and was wrong for
 * disclosing: every word the lexicon successfully translated was *also* present in its
 * original spelling, matched nothing, and was reported as something the catalogue could
 * not express.
 *
 * So "una noche de tormenta" rendered night, rain, wind and lightning, and then told
 * the user it could not do `noche` or `tormenta`. A claim of failure, made about
 * precisely the part that worked, on the path this project's owner actually types in.
 *
 * Disclosure is computed over the translated text alone now. These cases hold that:
 * what the catalogue can express must come back silent, and what it genuinely cannot
 * must still come back named — the mirror matters, because the cheap way to pass the
 * first half is to stop disclosing anything.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/intent/catalogue.js';
import { keywordModel } from '../../src/intent/model.js';

async function resolve(utterance: string) {
  return JSON.parse(
    await keywordModel.propose({ utterance, catalogue: CATALOGUE, worldPaths: [] }),
  ) as { primitives: { name: string }[]; unaddressed: string[] };
}

describe('Spanish disclosure (AC-17)', () => {
  it.each([
    ['una noche de tormenta', ['daylight', 'rain-emitter', 'wind-field', 'lightning']],
    ['quiero ver la aurora boreal', ['aurora']],
    ['hazlo de día', ['daylight']],
  ])('%s composes and discloses nothing', async (utterance, expected) => {
    const out = await resolve(utterance);
    expect(out.unaddressed).toEqual([]);
    for (const name of expected) expect(out.primitives.map((p) => p.name)).toContain(name);
  });

  it('still names what the catalogue genuinely cannot express', async () => {
    // The half that keeps the silence above from being achieved by never speaking.
    expect((await resolve('que llueva dinero')).unaddressed).toContain('dinero');
    expect((await resolve('make it rain money')).unaddressed).toContain('money');
  });
});
