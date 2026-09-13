/**
 * The compiler's use of a rig author, with the author stubbed.
 *
 * The live call needs a key and cannot be part of a suite that must run without one
 * (R-10), so what is held here is the wiring rather than the model: *when* the author is
 * asked, what happens to its answer, and — the part worth testing most — what happens
 * when it fails. A path that only works when the provider is up is a path that will be
 * discovered to be broken by a judge rather than by me.
 */
import { describe, expect, it, vi } from 'vitest';
import { CATALOGUE } from '../../src/intent/catalogue.js';
import { CatalogueIntentCompiler } from '../../src/intent/compiler.js';
import type { FigureAuthor } from '../../src/intent/figure-model.js';
import type { FigureSpec } from '../../src/intent/figures.js';
import type { WorldHandle } from '../../src/contracts.js';

const world = { state: {}, scene: null, clock: { elapsed: 0 } } as unknown as WorldHandle;

const CAR: FigureSpec = {
  name: 'red-car',
  origin: [-65, 0, 2],
  parts: [
    { id: 'body', shape: 'box', size: [14, 3, 6], color: [0.42, 0.06, 0.05], emissive: 0.2 },
    { id: 'cabin', shape: 'box', size: [6, 2.4, 5], color: [0.1, 0.11, 0.14], emissive: 0.15 },
  ],
  pose: 'const d = ((t * 12) % 200) - 100; p[0].y = 3; p[0].z = d; p[1].y = 7.4; p[1].z = d - 1;',
  rationale: 'un coche rojo cruzando la plaza',
  triggers: [],
  covers: ['coche', 'cruzando', 'plaza'],
};

function compilerWith(author: FigureAuthor) {
  return new CatalogueIntentCompiler({ catalogue: CATALOGUE, figureAuthor: author });
}

describe('the rig author, as the compiler uses it (AC-17)', () => {
  it('is asked when the catalogue leaves part of the request on the floor', async () => {
    // Not only on a total miss. "un coche rojo" resolves the red ground and not the car,
    // and asking only when nothing matched would answer half of it and call that
    // success.
    const author = { author: vi.fn(async () => CAR) };
    const out = await compilerWith(author).compile('un coche rojo cruzando la plaza', world);
    expect(author.author).toHaveBeenCalledOnce();
    if ('rejected' in out) throw new Error(out.reason);
    expect(out.brief.directives.map((d) => d.statePath)).toContain('figures.red-car');
    expect(out.unaddressed).toEqual([]);
  });

  it('is not asked when the catalogue answered the whole request', async () => {
    // The catalogue stays the cheap path, and a rig cannot be reached by asking for
    // weather. This is also what keeps a model call off the latency budget (R-8) for
    // the requests that never needed one.
    const author = { author: vi.fn(async () => CAR) };
    const out = await compilerWith(author).compile('make it rain', world);
    expect(author.author).not.toHaveBeenCalled();
    if ('rejected' in out) throw new Error(out.reason);
    expect(out.brief.directives.map((d) => d.name)).toEqual(['rain-emitter']);
  });

  it('is not asked when a written rig already answers', async () => {
    const author = { author: vi.fn(async () => CAR) };
    await compilerWith(author).compile('un perro con una persona paseando', world);
    expect(author.author).not.toHaveBeenCalled();
  });

  it('carries the authored pose through as source, not as data', async () => {
    const out = await compilerWith({ author: async () => CAR }).compile('un coche rojo', world);
    if ('rejected' in out) throw new Error(out.reason);
    const figure = out.brief.directives.find((d) => d.name === 'figure')!;
    expect(figure.params['poseSource']).toContain('p[0].z = d');
  });

  it('falls back to the catalogue answer when the author throws', async () => {
    // The case that actually happens: no key, a 503, a provider outage mid-request. The
    // catalogue's answer and its disclosure are still the right output, and a failed
    // author must not turn a partly-answerable request into a refusal.
    const out = await compilerWith({
      author: async () => { throw new Error('no ANTHROPIC_API_KEY on the server'); },
    }).compile('un coche rojo cruzando la plaza', world);
    if ('rejected' in out) throw new Error(out.reason);
    expect(out.brief.directives.map((d) => d.name)).toEqual(['ground-tint']);
    expect(out.unaddressed).toContain('coche');
  });

  it('still refuses when neither the catalogue nor the author can answer', async () => {
    const out = await compilerWith({ author: async () => null })
      .compile('summon a sentient octopus', world);
    expect('rejected' in out).toBe(true);
  });
});
