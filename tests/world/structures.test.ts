import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world.js';
import { evaluateContract, readPath, toVerdict } from '../../src/harness/l2-contract.js';
import { CatalogueIntentCompiler, isRejection } from '../../src/intent/compiler.js';
import { CONTRACT_WINDOW_FRAMES } from '../../src/intent/contract.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import type { Intent } from '../../src/contracts.js';
import {
  createGroundTint,
  createPrimitives,
  createSkylineShift,
  createTower,
  mountIntent,
  GROUND_STATE_PATH,
  SKYLINE_STATE_PATH,
  TOWER_STATE_PATH,
} from '../../src/world/index.js';

/**
 * The three structural verbs, end to end: catalogue -> compiler -> world -> oracle.
 *
 * Same shape as `lightning.test.ts`, and for the same reason: the contract these are
 * checked against is not written here. It is the one WS4 derives from the catalogue
 * entry's role-tagged fields, produced by the real compiler and evaluated by the real
 * L2 oracle, because a test asserting what the implementer *thought* the contract said
 * would agree with itself and with nothing else. Plain Node: no renderer, no GPU.
 */
const FRAME = 1 / 60;

const STRUCTURAL = [
  { name: 'tower', utterance: 'raise a tower', path: TOWER_STATE_PATH, animated: 'risePhase' },
  { name: 'skyline-shift', utterance: 'a taller denser city', path: SKYLINE_STATE_PATH, animated: 'shiftPhase' },
  { name: 'ground-tint', utterance: 'make it a desert', path: GROUND_STATE_PATH, animated: 'tintPhase' },
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

describe('structural primitives · the generated contract, against the real primitive', () => {
  it.each(STRUCTURAL)('resolves "$utterance" to $name and carries a contract (AC-16)', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);

    expect(intent.allowedPrimitives).toContain(entry.name);
    expect(intent.scope).toContain(entry.path);
    // The compiler only emits contracts that survived mutation hardening (AC-10), so
    // one assertion per declared field is evidence the entry is sound, not decorative.
    const spec = findPrimitive(CATALOGUE, entry.name)!;
    expect(intent.contract.assertions.length).toBeGreaterThanOrEqual(spec.fields.length);
  });

  it.each(STRUCTURAL)('satisfies the compiled contract for $name after a real tick window', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);

    mountIntent(world, createPrimitives({ seed: 31 }), intent);
    const { before, after } = runWindow(world);

    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.passed).toBe(true);
  });

  it.each(STRUCTURAL)('fails the $name contract when it is mounted but never ticked (AC-09)', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    mountIntent(world, createPrimitives({ seed: 32 }), intent);

    // "Present but inert" produced for real: every constant is right, nothing moves.
    // This is the whole reason the animated witness is a monotonic clock rather than
    // the eased value the binding actually draws — a saturating field would pass this
    // during the rise and fail it forever after.
    const { before, after } = runWindow(world, 0);
    const outcome = evaluateContract(intent.contract, before, after);

    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toEqual([`a:${entry.path}.${entry.animated}`]);
    expect(toVerdict(outcome).diagnosis).toContain('present but inert');
  });

  it.each(STRUCTURAL)('keeps $name animated long after it has finished moving', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    mountIntent(world, createPrimitives({ seed: 33 }), intent);

    // Ten seconds in, every eased value has saturated and the structure is standing
    // still. The contract must still pass: L2 decides correctness (D-1), so an
    // assertion that goes false once the world settles is a false rejection waiting
    // for a slow user.
    for (let i = 0; i < 600; i++) world.tick(FRAME);
    const { before, after } = runWindow(world);

    expect(evaluateContract(intent.contract, before, after).failedIds).toEqual([]);
  });

  it.each(STRUCTURAL)('reports the same verdict twice from the same seed for $name', async (entry) => {
    const run = async (): Promise<unknown> => {
      const world = new World();
      const intent = await compile(entry.utterance, world);
      mountIntent(world, createPrimitives({ seed: 34 }), intent);
      const { before, after } = runWindow(world, 300);
      return toVerdict(evaluateContract(intent.contract, before, after));
    };
    expect(await run()).toEqual(await run());
  });

  it('composes a structural verb with an atmospheric one, over disjoint slices', async () => {
    const world = new World();
    // Two workstreams' worth of world in one utterance: `desert` resolves ground-tint,
    // `windy` resolves wind-field. One contract spans both, and neither writes into
    // the other's slice (AC-05).
    const intent = await compile('a windy desert', world);
    expect(intent.scope).toEqual(expect.arrayContaining([GROUND_STATE_PATH, 'forces.wind']));

    mountIntent(world, createPrimitives({ seed: 35 }), intent);
    const { before, after } = runWindow(world);
    expect(evaluateContract(intent.contract, before, after).failedIds).toEqual([]);
  });
});

describe('tower · what it publishes for a binding to draw', () => {
  const spec = findPrimitive(CATALOGUE, 'tower')!;
  const mount = (params: Record<string, unknown> = {}) => {
    const world = new World();
    const instance = createTower({ seed: 3 }).mount(world, { ...spec.defaults, ...params });
    return { world, instance };
  };
  const read = (world: World, key: string): unknown => readPath(world.state, `${TOWER_STATE_PATH}.${key}`);

  it('grows into place rather than popping: heights start near zero and reach the request', () => {
    const { world } = mount({ height: 300, count: 1 });
    expect((read(world, 'grown') as number[])[0]).toBe(0);

    world.tick(FRAME);
    const early = (read(world, 'grown') as number[])[0]!;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(300 * 0.2);

    for (let i = 0; i < 600; i++) world.tick(FRAME);
    // The published height converges on the request, so a binding scaling straight
    // from `grown` ends up exactly as tall as the utterance asked for.
    expect((read(world, 'grown') as number[])[0]).toBeCloseTo(300, 5);
    expect(read(world, 'growth')).toBe(1);
  });

  it('publishes one site per requested tower, and staggers when they start', () => {
    const { world } = mount({ count: 4, height: 200 });
    for (let i = 0; i < 30; i++) world.tick(FRAME);

    const sites = read(world, 'sites') as number[][];
    expect(sites).toHaveLength(4);
    const grown = read(world, 'grown') as number[];
    // Half a second in, only the first has broken ground. A group that rises in
    // lockstep reads as one object with gaps in it, not as several towers.
    expect(grown[0]!).toBeGreaterThan(0);
    expect(grown[3]!).toBe(0);
  });

  it('lays sites out differently for each placement the schema admits', () => {
    const layout = (placement: string): number[][] =>
      readPath(mount({ placement, count: 4 }).world.state, `${TOWER_STATE_PATH}.sites`) as number[][];

    const center = layout('center');
    expect([center[0]![0], center[0]![1]]).toEqual([0, 0]);
    expect(layout('ring')).not.toEqual(center);
    expect(layout('avenue')).not.toEqual(center);
    // A placement is a constant, and the layout is a pure function of it: the same
    // request lays out the same city every run, which is what makes a shared link
    // (AC-20) rebuild the world the sender saw.
    expect(layout('ring')).toEqual(layout('ring'));
  });

  it('never moves a site under the tower standing on it', () => {
    const { world } = mount({ count: 3 });
    const first = structuredClone(read(world, 'sites'));
    for (let i = 0; i < 400; i++) world.tick(FRAME);
    // `layout()` is recomputed every step, so this is the check that it is genuinely
    // a function of the parameters and not of anything that advances with the frame.
    expect(read(world, 'sites')).toEqual(first);
  });
});

describe('skyline-shift · rescaling a city the user is already looking at', () => {
  const spec = findPrimitive(CATALOGUE, 'skyline-shift')!;
  const read = (world: World, key: string): unknown => readPath(world.state, `${SKYLINE_STATE_PATH}.${key}`);

  it('starts as a no-op and eases to the requested shape', () => {
    const world = new World();
    createSkylineShift({ seed: 4 }).mount(world, { ...spec.defaults, heightScale: 3, density: 0.5 });

    // Frame zero must be the authored city exactly, or the verb lands as a jump cut.
    expect(read(world, 'heightNow')).toBe(1);
    expect(read(world, 'densityNow')).toBe(1);

    for (let i = 0; i < 30; i++) world.tick(FRAME);
    expect(read(world, 'heightNow') as number).toBeGreaterThan(1);
    expect(read(world, 'densityNow') as number).toBeLessThan(1);

    for (let i = 0; i < 600; i++) world.tick(FRAME);
    expect(read(world, 'heightNow') as number).toBeCloseTo(3, 5);
    expect(read(world, 'densityNow') as number).toBeCloseTo(0.5, 5);
  });

  it('keeps the requested multipliers pinned while the eased ones move', () => {
    const world = new World();
    createSkylineShift({ seed: 4 }).mount(world, { heightScale: 2.5, density: 1.5 });
    for (let i = 0; i < 90; i++) world.tick(FRAME);

    // `heightScale` is the `constant` the contract pins with `equals`; a primitive
    // that eased the declared field instead would fail its own contract for the first
    // three seconds of behaving perfectly.
    expect(read(world, 'heightScale')).toBe(2.5);
    expect(read(world, 'density')).toBe(1.5);
  });
});

describe('ground-tint · what the world is made of', () => {
  const read = (world: World, key: string): unknown => readPath(world.state, `${GROUND_STATE_PATH}.${key}`);

  it('publishes the requested colour unmodified and cross-fades towards it', () => {
    const world = new World();
    createGroundTint({ seed: 5 }).mount(world, { color: [0.05, 0.05, 0.06], roughness: 0.2 });

    expect(read(world, 'color')).toEqual([0.05, 0.05, 0.06]);
    expect(read(world, 'mix')).toBe(0);

    for (let i = 0; i < 30; i++) world.tick(FRAME);
    const partway = read(world, 'mix') as number;
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(1);

    for (let i = 0; i < 600; i++) world.tick(FRAME);
    expect(read(world, 'mix')).toBe(1);
    // Unmodified throughout: the binding blends, the state does not.
    expect(read(world, 'color')).toEqual([0.05, 0.05, 0.06]);
  });

  it('never aliases the intent\'s own parameter array', () => {
    const world = new World();
    const color = [0.4, 0.3, 0.2];
    createGroundTint({ seed: 5 }).mount(world, { color, roughness: 0.5 });
    color[0] = 1;
    // A live world that changes because someone edited the intent afterwards is a
    // world whose contract was asserting over the wrong object.
    expect((read(world, 'color') as number[])[0]).toBe(0.4);
  });
});

describe('AC-12 · a structural verb leaves nothing behind when it is disposed', () => {
  it.each(STRUCTURAL)('removes the whole $name slice, its container and its registration', async (entry) => {
    const world = new World();
    world.setUserState('camera.position', [0, 2, 8]);
    const clean = world.snapshot();

    const intent = await compile(entry.utterance, world);
    const mounted = mountIntent(world, createPrimitives({ seed: 36 }), intent);
    for (let i = 0; i < 240; i++) world.tick(FRAME);
    for (const inst of mounted) inst.dispose();

    // R-4 makes the module leak structural, so the instance is the only thing that can
    // be freed; what is left has to be exactly the user's own state.
    expect(world.state).toEqual({ camera: { position: [0, 2, 8] } });
    expect(world.instanceIds).toEqual([]);
    expect(world.snapshot()).toEqual(clean);
  });

  it('shares the `structures` container between tower and skyline without either taking it', () => {
    const world = new World();
    const registry = createPrimitives({ seed: 37 });
    const tower = registry.get('tower')!.mount(world, findPrimitive(CATALOGUE, 'tower')!.defaults);
    const skyline = registry.get('skyline-shift')!.mount(world, findPrimitive(CATALOGUE, 'skyline-shift')!.defaults);

    tower.dispose();
    // The container survives its first tenant, because the second still lives there.
    expect(readPath(world.state, SKYLINE_STATE_PATH)).toBeDefined();
    skyline.dispose();
    expect(world.state).toEqual({});
  });

  it.each(STRUCTURAL)('makes a nulled disposer visible to the $name contract, which is the only way L2 sees it', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    const mounted = mountIntent(world, createPrimitives({ seed: 38 }), intent);

    const before = structuredClone(world.state);
    for (const inst of mounted) inst.dispose();
    const after = structuredClone(world.state);

    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toContain(`a:${entry.path}.instance`);
  });

  it.each(STRUCTURAL)('is inert and idempotent after $name is disposed', async (entry) => {
    const world = new World();
    const intent = await compile(entry.utterance, world);
    const mounted = mountIntent(world, createPrimitives({ seed: 39 }), intent);

    for (const inst of mounted) inst.dispose();
    for (const inst of mounted) {
      expect(() => inst.dispose()).not.toThrow();
      expect(() => inst.update(FRAME)).not.toThrow();
    }
    for (let i = 0; i < 60; i++) world.tick(FRAME);
    // A leaked instance that keeps ticking is a live failure, not a slow leak.
    expect(world.state).toEqual({});
  });
});
