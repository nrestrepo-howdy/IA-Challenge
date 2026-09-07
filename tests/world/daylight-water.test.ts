import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world.js';
import { evaluateContract, readPath, toVerdict } from '../../src/harness/l2-contract.js';
import { CatalogueIntentCompiler, isRejection } from '../../src/intent/compiler.js';
import { CONTRACT_WINDOW_FRAMES } from '../../src/intent/contract.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import type { Intent } from '../../src/contracts.js';
import {
  createDaylight,
  createPrimitives,
  createWater,
  mountIntent,
  AUTHORED_PHASE,
  DAYLIGHT_STATE_PATH,
  WATER_STATE_PATH,
} from '../../src/world/index.js';

/**
 * `daylight` and `water`, end to end: catalogue -> compiler -> world -> oracle.
 *
 * Same shape as `structures.test.ts`, and for the same reason: the contract is not
 * written here. It is the one WS4 derives from the catalogue entry's role-tagged
 * fields, produced by the real compiler and evaluated by the real L2 oracle — a test
 * asserting what the implementer *thought* the contract said would agree with itself
 * and with nothing else. Plain Node: no renderer, no GPU.
 */
const FRAME = 1 / 60;

const ENTRIES = [
  { name: 'daylight', utterance: 'make it day', path: DAYLIGHT_STATE_PATH, animated: 'dayClock' },
  { name: 'water', utterance: 'add water', path: WATER_STATE_PATH, animated: 'wavePhase' },
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

describe('daylight and water · the generated contract, against the real primitive', () => {
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

    mountIntent(world, createPrimitives({ seed: 41 }), intent);
    const { before, after } = runWindow(world);

    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.passed).toBe(true);
  });

  it.each(ENTRIES)('fails the $name contract when it is mounted but never ticked (AC-09)', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    mountIntent(world, createPrimitives({ seed: 42 }), intent);

    // "Present but inert" produced for real: every constant is right, nothing moves.
    const { before, after } = runWindow(world, 0);
    const outcome = evaluateContract(intent.contract, before, after);

    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toEqual([`a:${entry.path}.${entry.animated}`]);
    expect(toVerdict(outcome).diagnosis).toContain('present but inert');
  });

  it.each(ENTRIES)('keeps $name animated long after its cross-fade has finished', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    mountIntent(world, createPrimitives({ seed: 43 }), intent);

    // A minute in, the sky has arrived and the water has stopped rising. The contract
    // must still pass, which is the whole reason the animated witness is a monotonic
    // clock rather than the eased value the binding draws.
    for (let i = 0; i < 3600; i++) world.tick(FRAME);
    const { before, after } = runWindow(world);

    expect(evaluateContract(intent.contract, before, after).failedIds).toEqual([]);
  });

  it.each(ENTRIES)('leaves nothing behind at $path after dispose() (AC-12)', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    const mounted = mountIntent(world, createPrimitives({ seed: 44 }), intent);

    for (let i = 0; i < 120; i++) world.tick(FRAME);
    for (const instance of mounted.slice().reverse()) instance.dispose();

    expect(readPath(world.state, entry.path)).toBeUndefined();
    expect(world.instanceIds).toEqual([]);
  });

  it('floods a daylit world: two verbs, two disjoint slices, one contract', async () => {
    const world = new World();
    const intent = await compile('a sunny flooded city', world);
    expect(intent.scope).toEqual(expect.arrayContaining([DAYLIGHT_STATE_PATH, WATER_STATE_PATH]));

    mountIntent(world, createPrimitives({ seed: 45 }), intent);
    const { before, after } = runWindow(world);
    expect(evaluateContract(intent.contract, before, after).failedIds).toEqual([]);
  });
});

describe('daylight · what it publishes for a binding to draw', () => {
  const spec = findPrimitive(CATALOGUE, 'daylight')!;
  const mount = (params: Record<string, unknown> = {}) => {
    const world = new World();
    createDaylight({ seed: 5 }).mount(world, { ...spec.defaults, ...params });
    return world;
  };
  const read = (world: World, key: string): number =>
    readPath(world.state, `${DAYLIGHT_STATE_PATH}.${key}`) as number;

  it('starts at the authored night, so frame zero is the world already on screen', () => {
    const world = mount({ phase: 0.5, transition: 4 });
    expect(read(world, 'phaseNow')).toBe(AUTHORED_PHASE);
    expect(read(world, 'phase')).toBe(0.5);
  });

  it('cross-fades rather than cutting: the phase the binding draws moves every frame', () => {
    const world = mount({ phase: 0.5, transition: 4 });
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      world.tick(FRAME);
      seen.push(read(world, 'phaseNow'));
    }
    // Strictly increasing, and no single frame jumps a visible fraction of the clock.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
      expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.02);
    }
  });

  it('rises through dawn on the way to noon rather than taking the shorter arc', () => {
    const world = mount({ phase: 0.5, transition: 4 });
    let sawDawn = false;
    for (let i = 0; i < 300; i++) {
      world.tick(FRAME);
      const p = read(world, 'phaseNow');
      if (p > 0.2 && p < 0.3) sawDawn = true;
    }
    expect(sawDawn).toBe(true);
    expect(read(world, 'phaseNow')).toBeCloseTo(0.5, 4);
  });

  it('publishes a sun elevation the sky can be a function of', () => {
    const midnight = mount({ phase: 0, transition: 1 });
    expect(read(midnight, 'sunElevation')).toBeCloseTo(-1, 6);

    const noon = mount({ phase: 0.5, transition: 1 });
    for (let i = 0; i < 300; i++) noon.tick(FRAME);
    expect(read(noon, 'sunElevation')).toBeCloseTo(1, 3);
    expect(read(noon, 'brightness')).toBeCloseTo(1, 3);
  });

  it('reaches dusk going forward, not by running the day backwards', () => {
    const world = mount({ phase: 0.75, transition: 3 });
    let peaked = 0;
    for (let i = 0; i < 300; i++) {
      world.tick(FRAME);
      peaked = Math.max(peaked, read(world, 'sunElevation'));
    }
    // The sun got all the way up before it came back down: a dusk that dimmed straight
    // out of midnight would never have raised the elevation at all.
    expect(peaked).toBeGreaterThan(0.9);
    expect(read(world, 'phaseNow')).toBeCloseTo(0.75, 4);
  });
});

describe('water · what it publishes for a binding to draw', () => {
  const spec = findPrimitive(CATALOGUE, 'water')!;
  const mount = (params: Record<string, unknown> = {}) => {
    const world = new World();
    createWater({ seed: 6 }).mount(world, { ...spec.defaults, ...params });
    return world;
  };
  const read = (world: World, key: string): number =>
    readPath(world.state, `${WATER_STATE_PATH}.${key}`) as number;

  it('rises in rather than appearing, and converges on the requested level', () => {
    const world = mount({ level: 40 });
    const start = read(world, 'levelNow');
    expect(start).toBeLessThan(40);

    world.tick(FRAME);
    expect(read(world, 'levelNow')).toBeGreaterThan(start);

    for (let i = 0; i < 600; i++) world.tick(FRAME);
    expect(read(world, 'levelNow')).toBeCloseTo(40, 5);
    expect(read(world, 'mix')).toBe(1);
  });

  it('swells forever, at a rate the choppiness parameter actually sets', () => {
    const calm = mount({ choppiness: 0.05 });
    const rough = mount({ choppiness: 5 });
    for (let i = 0; i < 60; i++) {
      calm.tick(FRAME);
      rough.tick(FRAME);
    }
    expect(read(calm, 'wavePhase')).toBeGreaterThan(0);
    expect(read(rough, 'wavePhase')).toBeGreaterThan(read(calm, 'wavePhase') * 50);
  });

  it('floods at the same rate however choppy it is', () => {
    const calm = mount({ choppiness: 0.05, level: 10 });
    const rough = mount({ choppiness: 5, level: 10 });
    for (let i = 0; i < 60; i++) {
      calm.tick(FRAME);
      rough.tick(FRAME);
    }
    // The two clocks are separate on purpose: a swell parameter that quietly also set
    // the flood rate is how two individually correct values end up disagreeing.
    expect(read(calm, 'levelNow')).toBeCloseTo(read(rough, 'levelNow'), 10);
  });
});
