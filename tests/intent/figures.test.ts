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
import { FIGURES, matchFigure } from '../../src/intent/figures.js';
import { evaluateContract } from '../../src/harness/l2-contract.js';
import type { WorldHandle } from '../../src/contracts.js';

const world = { state: {}, scene: null, clock: { elapsed: 0 } } as unknown as WorldHandle;
const compiler = new CatalogueIntentCompiler({ catalogue: CATALOGUE });

/** A snapshot of the person rig at rest, sized to however many parts it currently has. */
function rest(): { count: number; pose: number[]; instance: string } {
  const parts = matchFigure('a person walking')!.parts.length;
  const pose = Array.from({ length: parts * 7 }, (_, i) => (i % 7 === 6 ? 1 : 0));
  return { count: parts, pose, instance: 'figure#0' };
}

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

describe('the freeform path (AC-17, AC-21)', () => {
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

describe('what opening the path did not cost (AC-22)', () => {
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

/**
 * The other half of AC-21: a rig that does not move must be rejected, not injected.
 *
 * "Present but inert" is the dominant real failure mode behind R-1, and on the catalogue
 * surface it is a primitive that mounts and never ticks. On the freeform surface it is
 * worse and more likely, because the motion is the part that was *written*: a pose that
 * throws, returns nothing, or sets the same numbers every frame produces a figure
 * standing in the plaza in a T-pose, with a state slice that exists, parts that are
 * correct, and nothing wrong that L0 or L1 can see.
 *
 * The contract catches it, and this proves the contract catches it by building one
 * against a real rig and running it over two snapshots that are identical.
 */
describe('a rig that does not move is rejected by L2 (AC-21)', () => {
  it('fails its own contract when pose is unchanged between frames', async () => {
    const out = await compiler.compile('a person walking', world);
    if ('rejected' in out) throw new Error(out.reason);

    const still = { figures: { walker: rest() } };
    const verdict = evaluateContract(out.contract, still, still);

    expect(verdict.passed).toBe(false);
    expect(verdict.failedIds).toContain('a:figures.walker.pose');
    const why = verdict.results.find((r) => r.id === 'a:figures.walker.pose')!;
    expect(why.detail).toMatch(/present but inert/);
  });

  it('passes the same contract once the pose moves', () => {
    // The half that keeps the assertion above from passing for the wrong reason: a
    // contract that rejected everything would satisfy the first test and be useless.
    // Derived from the rig rather than written out: the anatomy is edited often, and a
    // fixture that hard-codes a part count silently stops testing the rig it names the
    // moment a limb is split at a joint.
    const before = { figures: { walker: rest() } };
    const moved = rest();
    moved.pose[1] = 1.4;
    moved.pose[4] = 0.3;
    const after = { figures: { walker: moved } };
    return compiler.compile('a person walking', world).then((out) => {
      if ('rejected' in out) throw new Error(out.reason);
      expect(evaluateContract(out.contract, before, after).passed).toBe(true);
    });
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

/**
 * The pair rig concatenates two pose bodies over one flat `p` array, which means the
 * second rig's indices are offset by the first rig's part count. That offset was a
 * literal, and when the person grew from six parts to twelve it stayed at six: the dog
 * wrote its legs into the person's, and the result rendered as a legless figure over a
 * pile of loose sticks. Nothing in state looked wrong — every index written was a real
 * part, just the wrong one — so no oracle could have caught it.
 *
 * These two hold the whole class shut rather than the one instance: a pose may not
 * address a part the rig does not have, and a rig may not carry a part its pose never
 * places. The second is what makes a forgotten limb loud instead of invisible.
 */
describe('every rig poses exactly the parts it declares (AC-21)', () => {
  const indices = (pose: string): number[] =>
    [...pose.matchAll(/p\[(\d+)\]/g)].map((m) => Number(m[1]));

  for (const figure of FIGURES) {
    it(`"${figure.name}" writes no index past its ${figure.parts.length} parts`, () => {
      const written = indices(figure.pose);
      expect(written.length).toBeGreaterThan(0);
      expect(Math.max(...written)).toBeLessThan(figure.parts.length);
    });

    it(`"${figure.name}" leaves no declared part unplaced`, () => {
      const written = new Set(indices(figure.pose));
      const orphans = figure.parts
        .map((part, i) => (written.has(i) ? null : `${i}:${part.id}`))
        .filter((x): x is string => x !== null);
      expect(orphans).toEqual([]);
    });
  }
});
