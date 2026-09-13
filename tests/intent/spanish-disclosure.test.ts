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
  ) as { primitives: { name: string; params?: Record<string, unknown> }[]; unaddressed: string[] };
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

  it('applies the colour it was asked for, rather than a default it kept quiet about', async () => {
    // `rojo` used to map to the primitive's own name, `ground-tint`. That matched the
    // primitive, carried no colour into it, and disclosed nothing — so the ground
    // changed to something that was not red and the log said everything was fine.
    // Silent partial fulfilment, in the one primitive whose entire job is a colour.
    const out = await resolve('hazlo rojo');
    const tint = out.primitives.find((p) => p.name === 'ground-tint');
    expect(tint?.params?.['color']).toEqual([0.42, 0.07, 0.05]);
    expect(out.unaddressed).toEqual([]);
  });

  it('stops disclosing a word that set a parameter', async () => {
    // `red` is not what selects ground-tint — `ground` is — but it is what decides the
    // colour. A resolver that consumed it and then called it unaddressed is reporting
    // failure for the half that worked.
    expect((await resolve('make the ground red')).unaddressed).toEqual([]);
  });

  it('still discloses a colour nothing consumed', async () => {
    // The half that keeps the two above from being satisfied by never disclosing: fog
    // takes a colour and no hint reads `pink`, so the request is genuinely half met.
    expect((await resolve('add pink neon fog')).unaddressed).toContain('pink');
  });

  it('discloses a word that selects a primitive it can only half deliver', async () => {
    // `thunder` is the right keyword for lightning — it is what people type when they
    // want the sky to flash — and the catalogue has the flash and no sound. Treating it
    // as an ordinary keyword made the offline resolver claim a request it had half met;
    // dropping it would have made "thunder" resolve to nothing at all. It triggers, and
    // it is disclosed.
    const out = await resolve('thunder and lightning');
    expect(out.primitives.map((p) => p.name)).toContain('lightning');
    expect(out.unaddressed).toEqual(['thunder']);
  });

  it('does not disclose the whole phenomenon when the flash is what was asked for', async () => {
    // The half that keeps the rule above from becoming "always disclose": a
    // thunderstorm is the weather, and the weather is expressible.
    expect((await resolve('a thunderstorm')).unaddressed).toEqual([]);
  });

  it('moves the numbers an intensity word asks for, instead of disclosing it', async () => {
    const out = await resolve('heavy rain');
    const rain = out.primitives.find((p) => p.name === 'rain-emitter');
    expect(rain?.params?.['count']).toBe(16000);
    expect(out.unaddressed).toEqual([]);
  });

  it('still names what the catalogue genuinely cannot express', async () => {
    // The half that keeps the silence above from being achieved by never speaking.
    expect((await resolve('que llueva dinero')).unaddressed).toContain('dinero');
    expect((await resolve('make it rain money')).unaddressed).toContain('money');
  });
});
