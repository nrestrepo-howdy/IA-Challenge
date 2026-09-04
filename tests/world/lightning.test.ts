import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world.js';
import { evaluateContract, readPath, toVerdict } from '../../src/harness/l2-contract.js';
import { CatalogueIntentCompiler, isRejection } from '../../src/intent/compiler.js';
import { CONTRACT_WINDOW_FRAMES } from '../../src/intent/contract.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import type { Intent } from '../../src/contracts.js';
import { createLightning, createPrimitives, mountIntent, LIGHTNING_STATE_PATH } from '../../src/world/index.js';

/**
 * `lightning`, end to end: catalogue -> compiler -> world -> oracle.
 *
 * The contract this is checked against is not written here. It is the one WS4 derives
 * from the catalogue entry's role-tagged fields, produced by the real compiler and
 * evaluated by the real L2 oracle — because a test that asserts what the implementer
 * thought the contract said would agree with itself and with nothing else. Plain Node:
 * no renderer, no GPU.
 */
const FRAME = 1 / 60;
const SPEC = findPrimitive(CATALOGUE, 'lightning')!;

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

function read(world: World, key: string): unknown {
  return readPath(world.state, `${LIGHTNING_STATE_PATH}.${key}`);
}

describe('lightning · the generated contract, against the real primitive', () => {
  it('is resolved from the catalogue rather than invented, and carries a contract (AC-16)', async () => {
    const world = new World();
    const intent = await compile('add lightning', world);

    expect(intent.allowedPrimitives).toContain('lightning');
    expect(intent.scope).toContain(LIGHTNING_STATE_PATH);
    // The compiler only emits a contract that survived mutation hardening (AC-10), so
    // one assertion per declared field is evidence the entry is sound, not decorative.
    expect(intent.contract.assertions.length).toBeGreaterThanOrEqual(SPEC.fields.length);
  });

  it('satisfies the compiled contract after a real tick window', async () => {
    const world = new World();
    const intent = await compile('thunder and lightning', world);

    mountIntent(world, createPrimitives({ seed: 11 }), intent);
    const { before, after } = runWindow(world);

    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.passed).toBe(true);
  });

  it('fails the same contract when it is mounted but never ticked (AC-09)', async () => {
    const world = new World();
    const intent = await compile('lightning', world);
    mountIntent(world, createPrimitives({ seed: 12 }), intent);

    // "Present but inert" produced for real: every constant is right and nothing moves.
    const { before, after } = runWindow(world, 0);
    const outcome = evaluateContract(intent.contract, before, after);

    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toEqual([`a:${LIGHTNING_STATE_PATH}.phase`]);
    expect(toVerdict(outcome).diagnosis).toContain('present but inert');
  });

  it('reports the same verdict twice from the same seed, so a failure is reproducible', async () => {
    const run = async (): Promise<unknown> => {
      const world = new World();
      const intent = await compile('lightning', world);
      mountIntent(world, createPrimitives({ seed: 5 }), intent);
      const { before, after } = runWindow(world, 600);
      return toVerdict(evaluateContract(intent.contract, before, after));
    };
    expect(await run()).toEqual(await run());
  });
});

describe('lightning · flashes and afterglow', () => {
  const mount = (params: Record<string, unknown> = {}, seed = 3) => {
    const world = new World();
    const instance = createLightning({ seed }).mount(world, { ...SPEC.defaults, ...params });
    return { world, instance };
  };

  it('flashes occasionally rather than every frame', () => {
    const { world } = mount({ frequency: 1 });
    for (let i = 0; i < 600; i++) world.tick(FRAME);

    const flashes = read(world, 'flashes') as number;
    // Ten seconds at one strike per second, jittered by ±50% of the interval.
    expect(flashes).toBeGreaterThan(2);
    expect(flashes).toBeLessThan(30);
  });

  it('decays the afterglow towards zero between strikes, never past the requested peak', () => {
    const { world } = mount({ frequency: 0.05, intensity: 6, decay: 4 });
    let peakSeen = 0;
    for (let i = 0; i < 900; i++) {
      world.tick(FRAME);
      peakSeen = Math.max(peakSeen, read(world, 'glow') as number);
    }
    // At one strike per twenty seconds, fifteen seconds of frames is all afterglow.
    const glow = read(world, 'glow') as number;
    expect(peakSeen).toBeLessThanOrEqual(6);
    expect(glow).toBeGreaterThanOrEqual(0);
    expect(glow).toBeLessThan(0.01);
  });

  it('advances `phase` on every tick, at the slowest frequency the schema admits', () => {
    // The animated field is what L2 asserts over, so it has to move for the whole
    // admitted parameter range and not only for the default.
    const { world } = mount({ frequency: 0.02 });
    for (let i = 0; i < 240; i++) {
      const prior = read(world, 'phase') as number;
      world.tick(FRAME);
      expect(read(world, 'phase') as number).toBeGreaterThan(prior);
    }
  });

  it('produces identical state from the same seed and different state from another', () => {
    const runTo = (seed: number): unknown => {
      const { world } = mount({}, seed);
      for (let i = 0; i < 300; i++) world.tick(FRAME);
      return structuredClone(world.state);
    };
    expect(runTo(21)).toEqual(runTo(21));
    expect(runTo(21)).not.toEqual(runTo(22));
  });
});

describe('lightning · dispose() leaves nothing behind (R-4)', () => {
  it('removes its slice, its container and its registration', () => {
    const world = new World();
    const instance = createLightning({ seed: 7 }).mount(world, SPEC.defaults);
    for (let i = 0; i < 120; i++) world.tick(FRAME);
    expect(read(world, 'instance')).toBe(instance.id);

    instance.dispose();

    // The slice is gone, and so is the `weather` container this mount created: what
    // remains is exactly the state the user had before (AC-12, AC-15).
    expect(world.state).toEqual({});
    expect(world.instanceIds).toEqual([]);
  });

  it('is inert and idempotent after disposal: a ticked leak is a live failure', () => {
    const world = new World();
    const instance = createLightning({ seed: 8 }).mount(world, SPEC.defaults);
    instance.dispose();

    expect(() => instance.dispose()).not.toThrow();
    expect(() => instance.update(FRAME)).not.toThrow();
    for (let i = 0; i < 60; i++) world.tick(FRAME);
    expect(world.state).toEqual({});
  });

  it('makes a nulled disposer visible to the contract, which is the only way L2 sees it', async () => {
    const world = new World();
    const intent = await compile('lightning', world);
    const [bolt] = mountIntent(world, createPrimitives({ seed: 9 }), intent);

    const before = structuredClone(world.state);
    bolt!.dispose();
    const after = structuredClone(world.state);

    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toContain(`a:${LIGHTNING_STATE_PATH}.instance`);
  });
});
