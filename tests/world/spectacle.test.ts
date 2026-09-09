import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world.js';
import { evaluateContract, readPath, toVerdict } from '../../src/harness/l2-contract.js';
import { CatalogueIntentCompiler, isRejection } from '../../src/intent/compiler.js';
import { CONTRACT_WINDOW_FRAMES } from '../../src/intent/contract.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import type { Intent } from '../../src/contracts.js';
import {
  createAurora,
  createDaylight,
  createFlock,
  createPrimitives,
  createSearchlights,
  mountIntent,
  AURORA_STATE_PATH,
  FLOCK_STATE_PATH,
  SEARCHLIGHT_STATE_PATH,
} from '../../src/world/index.js';

/**
 * `aurora`, `flock` and `searchlights`, end to end: catalogue -> compiler -> world ->
 * oracle.
 *
 * Same shape as `daylight-water.test.ts`, and for the same reason: the contract is not
 * written here. It is the one WS4 derives from the catalogue entry's role-tagged
 * fields, produced by the real compiler and evaluated by the real L2 oracle — a test
 * asserting what the implementer *thought* the contract said would agree with itself
 * and with nothing else. Plain Node: no renderer, no GPU.
 */
const FRAME = 1 / 60;

const ENTRIES = [
  { name: 'aurora', utterance: 'add aurora', path: AURORA_STATE_PATH, animated: 'curtainPhase' },
  { name: 'flock', utterance: 'add a flock of birds', path: FLOCK_STATE_PATH, animated: 'flightPhase' },
  {
    name: 'searchlights',
    utterance: 'add searchlights',
    path: SEARCHLIGHT_STATE_PATH,
    animated: 'sweepPhase',
  },
] as const;

async function compile(utterance: string, world: World): Promise<Intent> {
  const result = await new CatalogueIntentCompiler().compile(utterance, world);
  if (isRejection(result)) throw new Error(`unexpectedly rejected: ${result.reason}`);
  return result;
}

function runWindow(world: World, frames = CONTRACT_WINDOW_FRAMES): { before: unknown; after: unknown } {
  const before = structuredClone(world.state);
  for (let i = 0; i < frames; i++) world.tick(FRAME);
  return { before, after: structuredClone(world.state) };
}

describe('aurora, flock and searchlights · the generated contract, against the real primitive', () => {
  it.each(ENTRIES)('resolves "$utterance" to $name and carries a contract (AC-16)', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);

    expect(intent.allowedPrimitives).toContain(entry.name);
    expect(intent.scope).toContain(entry.path);
    const spec = findPrimitive(CATALOGUE, entry.name)!;
    expect(intent.contract.assertions.length).toBeGreaterThanOrEqual(spec.fields.length);
  });

  it.each(ENTRIES)('satisfies the compiled contract for $name after a real tick window', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);

    mountIntent(world, createPrimitives({ seed: 51 }), intent);
    const { before, after } = runWindow(world);

    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.passed).toBe(true);
  });

  it.each(ENTRIES)('fails the $name contract when it is mounted but never ticked (AC-09)', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    mountIntent(world, createPrimitives({ seed: 52 }), intent);

    // "Present but inert" produced for real: every constant is right, nothing moves.
    const { before, after } = runWindow(world, 0);
    const outcome = evaluateContract(intent.contract, before, after);

    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toEqual([`a:${entry.path}.${entry.animated}`]);
    expect(toVerdict(outcome).diagnosis).toContain('present but inert');
  });

  it.each(ENTRIES)('keeps $name animated a minute after it has arrived', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    mountIntent(world, createPrimitives({ seed: 53 }), intent);

    // A minute in, the curtains are up and the lamps are at full power. The contract
    // must still pass, which is the whole reason each animated witness is a monotonic
    // clock rather than the eased or wrapping value its binding draws.
    for (let i = 0; i < 3600; i++) world.tick(FRAME);
    const { before, after } = runWindow(world);

    expect(evaluateContract(intent.contract, before, after).failedIds).toEqual([]);
  });

  it.each(ENTRIES)('leaves nothing behind at $path after dispose() (AC-12)', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    const mounted = mountIntent(world, createPrimitives({ seed: 54 }), intent);

    for (let i = 0; i < 120; i++) world.tick(FRAME);
    for (const instance of mounted.slice().reverse()) instance.dispose();

    expect(readPath(world.state, entry.path)).toBeUndefined();
    expect(world.instanceIds).toEqual([]);
  });

  it.each(ENTRIES)('reports the same state twice from the same seed for $name', async (entry) => {
    const run = async (): Promise<unknown> => {
      const world = new World();
      const intent = await compile(entry.utterance, world);
      mountIntent(world, createPrimitives({ seed: 55 }), intent);
      for (let i = 0; i < 300; i++) world.tick(FRAME);
      return structuredClone(world.state);
    };
    expect(await run()).toEqual(await run());
  });

  it('lights a flock over an aurora: three verbs, three disjoint slices, one contract', async () => {
    const world = new World();
    const intent = await compile('aurora searchlights and birds', world);
    expect(intent.scope).toEqual(
      expect.arrayContaining([AURORA_STATE_PATH, FLOCK_STATE_PATH, SEARCHLIGHT_STATE_PATH]),
    );

    mountIntent(world, createPrimitives({ seed: 56 }), intent);
    const { before, after } = runWindow(world);
    expect(evaluateContract(intent.contract, before, after).failedIds).toEqual([]);
  });
});

describe('aurora · what it publishes for a binding to draw', () => {
  const spec = findPrimitive(CATALOGUE, 'aurora')!;
  const mount = (params: Record<string, unknown> = {}, world = new World()) => {
    createAurora({ seed: 7 }).mount(world, { ...spec.defaults, ...params });
    return world;
  };
  const read = (world: World, key: string): number =>
    readPath(world.state, `${AURORA_STATE_PATH}.${key}`) as number;

  it('brightens in rather than switching on, and settles at the requested intensity', () => {
    const world = mount({ intensity: 2 });
    expect(read(world, 'glow')).toBe(0);

    world.tick(FRAME);
    expect(read(world, 'glow')).toBeGreaterThan(0);

    for (let i = 0; i < 600; i++) world.tick(FRAME);
    expect(read(world, 'glow')).toBeCloseTo(2, 5);
  });

  it('is put out by daylight and comes back at night', () => {
    // The whole point of the entry: an aurora at noon is not a dimmer aurora, it is a
    // mistake. `daylight` publishes the brightness; the aurora reads it across slices
    // the way rain reads the wind, and writes only inside its own (AC-05).
    const world = new World();
    createDaylight({ seed: 7 }).mount(world, { phase: 0.5, transition: 2 });
    mount({ intensity: 3 }, world);

    for (let i = 0; i < 600; i++) world.tick(FRAME);
    expect(read(world, 'visibility')).toBe(0);
    expect(read(world, 'glow')).toBe(0);

    // The curtains are invisible, and the clock the contract asserts over is still
    // running: a verb that stops being drawn has not stopped being mounted.
    const phase = read(world, 'curtainPhase');
    world.tick(FRAME);
    expect(read(world, 'curtainPhase')).toBeGreaterThan(phase);
  });

  it('stays at full strength in a world with no time of day, which is the authored one', () => {
    const world = mount();
    for (let i = 0; i < 300; i++) world.tick(FRAME);
    expect(read(world, 'visibility')).toBe(1);
  });

  it('drifts at the same rate however faint it is asked to be', () => {
    const faint = mount({ intensity: 0.1 });
    const blazing = mount({ intensity: 4 });
    for (let i = 0; i < 120; i++) {
      faint.tick(FRAME);
      blazing.tick(FRAME);
    }
    // The schema admits a nearly invisible aurora, and a drift clock scaled by
    // intensity would then be provably inert — an `animated` field that fails for a
    // legal parameter is a contract that rejects a primitive which is behaving.
    expect(read(faint, 'curtainPhase')).toBeGreaterThan(0);
    expect(read(faint, 'curtainPhase')).toBeCloseTo(read(blazing, 'curtainPhase'), 10);
  });
});

describe('flock · what it publishes for a binding to draw', () => {
  const spec = findPrimitive(CATALOGUE, 'flock')!;
  const mount = (params: Record<string, unknown> = {}) => {
    const world = new World();
    createFlock({ seed: 8 }).mount(world, { ...spec.defaults, ...params });
    return world;
  };
  const centroid = (world: World): number[] =>
    readPath(world.state, `${FLOCK_STATE_PATH}.centroid`) as number[];

  it('never stops moving: the flock is somewhere new on every single frame', () => {
    const world = mount();
    let previous = centroid(world).slice();
    for (let i = 0; i < 600; i++) {
      world.tick(FRAME);
      const now = centroid(world);
      // A static swarm is worse than no swarm, so this is asserted per frame rather
      // than across the contract window: a flock that stalls for a frame here is a
      // flock that can stall for a window somewhere else.
      const moved = Math.hypot(now[0]! - previous[0]!, now[1]! - previous[1]!, now[2]! - previous[2]!);
      expect(moved).toBeGreaterThan(0);
      previous = now.slice();
    }
  });

  it('flies at the speed it was asked to, and stays near the altitude it was given', () => {
    const world = mount({ speed: 30, altitude: 200 });
    const start = centroid(world).slice();
    let travelled = 0;
    let previous = start;
    for (let i = 0; i < 60; i++) {
      world.tick(FRAME);
      const now = centroid(world);
      travelled += Math.hypot(now[0]! - previous[0]!, now[1]! - previous[1]!, now[2]! - previous[2]!);
      // The wander is in the path, not in the altitude: birds that climb 200 units
      // over a second are not birds.
      expect(now[1]!).toBeGreaterThan(200 * 0.8);
      expect(now[1]!).toBeLessThan(200 * 1.2);
      previous = now;
    }
    // One second at 30 units per second, give or take the curvature of the circuit.
    expect(travelled).toBeGreaterThan(20);
    expect(travelled).toBeLessThan(40);
  });

  it('comes back around, which is why the position is not the animated witness', () => {
    const world = mount({ speed: 60 });
    const start = centroid(world).slice();
    let closest = Infinity;
    // One lap of the circuit at the schema's top speed.
    for (let i = 0; i < 60 * 60; i++) {
      world.tick(FRAME);
      const now = centroid(world);
      if (i > 600) {
        closest = Math.min(
          closest,
          Math.hypot(now[0]! - start[0]!, now[1]! - start[1]!, now[2]! - start[2]!),
        );
      }
    }
    expect(closest).toBeLessThan(20);
    // `flightPhase` is arc length flown, so it does not: it is the clock the circuit
    // is a function of, and `changesOverTime` over a value that returns to where it
    // started is a stopwatch rather than an oracle.
    expect(readPath(world.state, `${FLOCK_STATE_PATH}.flightPhase`) as number).toBeGreaterThan(3000);
  });
});

describe('searchlights · what they publish for a binding to draw', () => {
  const spec = findPrimitive(CATALOGUE, 'searchlights')!;
  const mount = (params: Record<string, unknown> = {}) => {
    const world = new World();
    createSearchlights({ seed: 9 }).mount(world, { ...spec.defaults, ...params });
    return world;
  };
  const aim = (world: World): number[][] =>
    readPath(world.state, `${SEARCHLIGHT_STATE_PATH}.aim`) as number[][];

  it('stands up one lamp per requested beam, on the ground', () => {
    const world = mount({ beams: 7 });
    const lamps = readPath(world.state, `${SEARCHLIGHT_STATE_PATH}.lamps`) as number[][];
    expect(lamps.length).toBe(7);
    expect(aim(world).length).toBe(7);
    for (const lamp of lamps) {
      expect(Math.hypot(lamp[0]!, lamp[1]!)).toBeCloseTo(205, 6);
    }
  });

  it('hands the binding a wrapped angle and keeps an unwrapped clock for the oracle', () => {
    const world = mount({ speed: 4, beams: 3 });
    for (let i = 0; i < 600; i++) {
      world.tick(FRAME);
      for (const [azimuth] of aim(world)) {
        expect(azimuth!).toBeGreaterThanOrEqual(0);
        expect(azimuth!).toBeLessThan(Math.PI * 2);
      }
    }
    // Ten seconds at 4 rad/s is more than one turn, so the published angles have come
    // back around while the witness has not.
    expect(readPath(world.state, `${SEARCHLIGHT_STATE_PATH}.sweepPhase`) as number).toBeGreaterThan(
      Math.PI * 2,
    );
  });

  it('sweeps the beams apart rather than in lockstep', () => {
    const world = mount({ beams: 4, speed: 1 });
    for (let i = 0; i < 300; i++) world.tick(FRAME);
    const angles = aim(world).map(([a]) => a!);
    const spread = new Set(angles.map((a) => a.toFixed(3)));
    // Lamps in lockstep read as one mechanism seen four times; the crossing is the
    // picture, so unequal rates are a property rather than a decoration.
    expect(spread.size).toBe(angles.length);
  });

  it('warms up rather than snapping to full power, at every legal sweep rate', () => {
    for (const speed of [0.05, 4]) {
      const world = mount({ speed });
      expect(readPath(world.state, `${SEARCHLIGHT_STATE_PATH}.glow`)).toBe(0);
      for (let i = 0; i < 300; i++) world.tick(FRAME);
      expect(readPath(world.state, `${SEARCHLIGHT_STATE_PATH}.glow`)).toBe(1);
      // The slowest legal sweep still moves the witness on every step.
      expect(readPath(world.state, `${SEARCHLIGHT_STATE_PATH}.sweepPhase`) as number).toBeGreaterThan(0);
    }
  });
});
