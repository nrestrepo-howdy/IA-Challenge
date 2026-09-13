/**
 * The freeform path, from utterance to a verified intent.
 *
 * "un perro con una persona paseando" used to compile to a refusal — correctly, given a
 * catalogue of weather and light, and fatally, given a product that says the world
 * becomes what you say. This is the path that answers it, and what these hold is that
 * opening it did not cost the two properties the refusal was protecting.
 *
 * The first is that the catalogue stays closed: "make it rain" still resolves to rain
 * and nothing else, and a rig cannot be reached by asking for weather. The second is
 * that the world still says no — a request no rig and no primitive can meet is still
 * rejected, because a system that answers everything is a system whose answers mean
 * nothing.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/intent/catalogue.js';
import { CatalogueIntentCompiler } from '../../src/intent/compiler.js';
import { matchFigure } from '../../src/intent/figures.js';
import type { WorldHandle } from '../../src/contracts.js';

const world = { state: {}, scene: null, clock: { elapsed: 0 } } as unknown as WorldHandle;
const compiler = new CatalogueIntentCompiler({ catalogue: CATALOGUE });

async function compile(utterance: string) {
  const out = await compiler.compile(utterance, world);
  if ('rejected' in out) return { rejected: true as const, reason: out.reason };
  return {
    rejected: false as const,
    paths: out.brief.directives.map((d) => d.statePath),
    names: out.brief.directives.map((d) => d.name),
    unaddressed: out.unaddressed,
    assertions: out.contract.assertions.map((a) => `${a.kind}:${a.path}`),
    scope: out.scope,
    source: out.brief.directives.find((d) => d.name === 'figure')?.params['poseSource'],
  };
}

describe('the freeform path (AC-17)', () => {
  it('builds a rig for a request the catalogue cannot express', async () => {
    const out = await compile('un perro con una persona paseando');
    expect(out.rejected).toBe(false);
    if (out.rejected) return;
    expect(out.paths).toEqual(['figures.dog-walker']);
    expect(out.scope).toEqual(['figures.dog-walker']);
  });

  it('composes a rig alongside the weather, rather than choosing between them', async () => {
    const out = await compile('a dog in the rain');
    if (out.rejected) throw new Error(out.reason);
    expect(out.paths).toEqual(['weather.rain', 'figures.dog']);
  });

  it('asserts that the rig moves, which is what catches a figure standing in a T-pose', async () => {
    const out = await compile('a person walking');
    if (out.rejected) throw new Error(out.reason);
    expect(out.assertions).toContain('changesOverTime:figures.walker.pose');
    expect(out.assertions).toContain('exists:figures.walker.instance');
  });

  it('stops disclosing the words the rig answers for', async () => {
    // The resolver reports "dog" as beyond the catalogue, which is true of the catalogue
    // and no longer true of the world. Leaving it in would tell the user the thing
    // walking across the frame is not there.
    const out = await compile('un perro con una persona paseando');
    if (out.rejected) throw new Error(out.reason);
    expect(out.unaddressed).toEqual([]);
  });

  it('carries the pose as source, because a function cannot cross a JSON brief', async () => {
    const out = await compile('a person walking');
    if (out.rejected) throw new Error(out.reason);
    expect(typeof out.source).toBe('string');
    expect(String(out.source)).toContain('Math.sin');
  });
});

describe('what opening the path did not cost', () => {
  it('leaves the catalogue closed: weather still resolves to weather', async () => {
    const out = await compile('make it rain');
    if (out.rejected) throw new Error(out.reason);
    expect(out.names).toEqual(['rain-emitter']);
  });

  it('still refuses what neither a primitive nor a rig can do', async () => {
    const out = await compile('summon a sentient octopus');
    expect(out.rejected).toBe(true);
  });
});

describe('matchFigure', () => {
  it('prefers the longer trigger, so the pair beats either half', () => {
    expect(matchFigure('walking the dog')?.name).toBe('dog-walker');
    expect(matchFigure('a dog')?.name).toBe('dog');
  });

  it('matches nothing in a request about the weather', () => {
    expect(matchFigure('heavy rain and wind')).toBeNull();
  });
});
