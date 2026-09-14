/**
 * The figure primitive: the one place the agent writes behaviour instead of choosing it.
 *
 * Everything else in this world is composed from a closed catalogue, which is what made
 * the harness comfortable — there was never anything dangerous to verify. A rig carries
 * a `pose` function that was *written*, not selected, so the guarantees have to come
 * from somewhere: they come from validation at the boundary and clamping on the way out.
 *
 * What these hold is the pair that matters. A rig that cannot be described is refused
 * before it runs, with a reason naming the part; and a rig that runs badly — returning
 * NaN, reaching for the horizon, growing without limit — is contained rather than
 * trusted, because a pose that misbehaves for one frame is not a reason to tear down a
 * world.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { createFigure, FIGURE_BOUNDS, FigureValidationError, type FigureParams } from '../../src/world/figure.js';

const PART = { id: 'body', shape: 'box', size: [1, 1, 1], color: [0.5, 0.5, 0.5] } as const;

function mount(overrides: Partial<FigureParams> = {}): World {
  const world = new World();
  createFigure().mount(world, {
    name: 'rig', parts: [PART], pose: () => {}, ...overrides,
  } as FigureParams);
  return world;
}

const slice = (world: World, name = 'rig'): Record<string, unknown> =>
  (world.state as Record<string, Record<string, Record<string, unknown>>>)['figures']![name]!;

describe('figure · what it refuses (AC-06)', () => {
  const bad: [string, Partial<FigureParams>][] = [
    ['a name that is not a path segment', { name: 'Rig One!' }],
    ['no parts at all', { parts: [] }],
    ['a shape that is not in the vocabulary', { parts: [{ ...PART, shape: 'dodecahedron' as never }] }],
    ['two parts sharing an id', { parts: [PART, PART] }],
    ['a size that is not three numbers', { parts: [{ ...PART, size: [1, 1] as never }] }],
    ['a part larger than the bound', { parts: [{ ...PART, size: [1, FIGURE_BOUNDS.size + 1, 1] }] }],
    ['a pose that is not a function', { pose: 'Math.sin(t)' as never }],
  ];
  for (const [what, overrides] of bad) {
    it(`refuses ${what}, by name`, () => {
      expect(() => mount(overrides)).toThrow(FigureValidationError);
    });
  }

  it('names the offending part rather than the rig', () => {
    // The generated half of a rig is the part list; a rejection that says only "invalid
    // figure" leaves a repair agent with nothing to act on (§ diagnoses are actionable).
    expect(() => mount({ parts: [PART, { ...PART, id: 'leg', size: [1, FIGURE_BOUNDS.size + 1, 1] }] }))
      .toThrow(/part 'leg'/);
  });
});

describe('figure · what it publishes (AC-14)', () => {
  it('publishes a pose of seven numbers per part, before the first frame', () => {
    const world = mount({ parts: [PART, { ...PART, id: 'head' }] });
    expect(slice(world)['count']).toBe(2);
    expect(slice(world)['pose']).toHaveLength(14);
  });

  it('moves, which is the assertion the contract is built on', () => {
    const world = mount({ pose: (t, p) => { p[0]!.y = Math.sin(t * 4) * 3; } });
    const before = [...(slice(world)['pose'] as number[])];
    for (let i = 0; i < 12; i++) world.tick(1 / 60);
    expect(slice(world)['pose']).not.toEqual(before);
  });

  it('resets to rest between frames, so a partial pose cannot accumulate drift', () => {
    // A `pose` that sets a part only on some frames would otherwise inherit whatever
    // the last frame left, and drift in a direction nobody wrote.
    let frame = 0;
    const world = mount({ pose: (_t, p) => { if (frame++ % 2 === 0) p[0]!.y = 5; } });
    world.tick(1 / 60);
    expect((slice(world)['pose'] as number[])[1]).toBe(0);
  });
});

describe('figure · what it contains (R-9)', () => {
  it('turns NaN into zero rather than into a hole in the state', () => {
    const world = mount({ pose: (_t, p) => { p[0]!.x = NaN; p[0]!.scale = NaN; } });
    world.tick(1 / 60);
    const pose = slice(world)['pose'] as number[];
    expect(pose[0]).toBe(0);
    expect(pose[6]).toBe(1);
  });

  it('clamps a part that reaches past the world', () => {
    const world = mount({ pose: (_t, p) => { p[0]!.y = 1e9; } });
    world.tick(1 / 60);
    expect((slice(world)['pose'] as number[])[1]).toBeLessThanOrEqual(FIGURE_BOUNDS.reach);
  });

  it('clamps scale, so one part cannot become the frame', () => {
    const world = mount({ pose: (_t, p) => { p[0]!.scale = 1e6; } });
    world.tick(1 / 60);
    expect((slice(world)['pose'] as number[])[6]).toBeLessThanOrEqual(FIGURE_BOUNDS.scale);
  });
});
