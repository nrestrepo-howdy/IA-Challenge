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

const BALLOON: FigureSpec = {
  name: 'hot-air-balloon',
  origin: [-65, 0, 2],
  parts: [
    { id: 'envelope', shape: 'sphere', size: [11, 13, 11], color: [0.5, 0.12, 0.1], emissive: 0.3 },
    { id: 'basket', shape: 'box', size: [2.6, 2, 2.6], color: [0.3, 0.22, 0.12], emissive: 0.2 },
  ],
  pose: 'const rise = 40 + Math.sin(t * 0.3) * 9; p[0].y = rise; p[1].y = rise - 16;',
  rationale: 'a hot air balloon drifting over the plaza',
  triggers: [],
  covers: ['balloon', 'hot', 'air', 'drifting', 'plaza'],
};

function compilerWith(author: FigureAuthor) {
  return new CatalogueIntentCompiler({ catalogue: CATALOGUE, figureAuthor: author });
}

describe('the rig author, as the compiler uses it (AC-17)', () => {
  it('is asked when the catalogue leaves part of the request on the floor', async () => {
    // Not only on a total miss. "a hot air balloon over the plaza" resolves nothing the
    // catalogue owns and nothing the written rig library owns either — but the general
    // case is a request the catalogue *half* answers, and asking only when nothing
    // matched at all would answer half of it and call that success.
    const author = { author: vi.fn(async () => BALLOON) };
    const out = await compilerWith(author).compile('a hot air balloon over the plaza', world);
    expect(author.author).toHaveBeenCalledOnce();
    if ('rejected' in out) throw new Error(out.reason);
    expect(out.brief.directives.map((d) => d.statePath)).toContain('figures.hot-air-balloon');
    expect(out.unaddressed).toEqual([]);
  });

  it('is not asked when the catalogue answered the whole request', async () => {
    // The catalogue stays the cheap path, and a rig cannot be reached by asking for
    // weather. This is also what keeps a model call off the latency budget (R-8) for
    // the requests that never needed one.
    const author = { author: vi.fn(async () => BALLOON) };
    const out = await compilerWith(author).compile('make it rain', world);
    expect(author.author).not.toHaveBeenCalled();
    if ('rejected' in out) throw new Error(out.reason);
    expect(out.brief.directives.map((d) => d.name)).toEqual(['rain-emitter']);
  });

  it('is not asked when a written rig already answers', async () => {
    const author = { author: vi.fn(async () => BALLOON) };
    await compilerWith(author).compile('un perro con una persona paseando', world);
    expect(author.author).not.toHaveBeenCalled();
  });

  it('carries the authored pose through as source, not as data', async () => {
    const out = await compilerWith({ author: async () => BALLOON }).compile('a hot air balloon', world);
    if ('rejected' in out) throw new Error(out.reason);
    const figure = out.brief.directives.find((d) => d.name === 'figure')!;
    expect(figure.params['poseSource']).toContain('p[0].y = rise');
  });

  it('falls back to the catalogue answer when the author throws', async () => {
    // The case that actually happens: no key, a 503, a provider outage mid-request. The
    // catalogue's answer and its disclosure are still the right output, and a failed
    // author must not turn a partly-answerable request into a refusal.
    // The utterance is one the catalogue answers *in part*: rain resolves, the balloon
    // does not. That is the case this guards — when nothing at all resolves and the
    // author is unreachable, a refusal is the right answer and the test below covers it.
    const out = await compilerWith({
      author: async () => { throw new Error('no ANTHROPIC_API_KEY on the server'); },
    }).compile('a hot air balloon in the rain', world);
    if ('rejected' in out) throw new Error(out.reason);
    expect(out.brief.directives.map((d) => d.name)).toEqual(['rain-emitter']);
    expect(out.unaddressed).toContain('balloon');
  });

  it('still refuses when neither the catalogue nor the author can answer', async () => {
    const out = await compilerWith({ author: async () => null })
      .compile('summon a sentient octopus', world);
    expect('rejected' in out).toBe(true);
  });
});
