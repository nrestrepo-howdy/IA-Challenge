import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world.js';
import { evaluateContract, toVerdict } from '../../src/harness/l2-contract.js';
import { CatalogueIntentCompiler, isRejection } from '../../src/intent/compiler.js';
import { CONTRACT_WINDOW_FRAMES } from '../../src/intent/contract.js';
import type { Intent } from '../../src/contracts.js';
import { createPrimitives, mountIntent } from '../../src/world/index.js';
import { makeIntent } from '../fixtures.js';

/**
 * The end-to-end agreement test: catalogue -> compiler -> world -> oracle.
 *
 * Every other test in this workstream checks one layer against its own idea of what
 * the neighbouring layer wants. This one uses the real thing at every step — a real
 * compiled intent from `CatalogueIntentCompiler`, the real primitives mounted into a
 * real `World`, the real frame tick, and the real L2 oracle evaluating the contract
 * WS4 generated — because four layers can each be self-consistent and still disagree
 * with each other, and that disagreement is precisely what would ship a broken
 * verifier. It runs in plain Node: no renderer, no GPU, no browser.
 */
const FRAME = 1 / 60;

async function compile(utterance: string, world: World): Promise<Intent> {
  const result = await new CatalogueIntentCompiler().compile(utterance, world);
  if (isRejection(result)) throw new Error(`unexpectedly rejected: ${result.reason}`);
  return result;
}

/** Runs the contract's scripted window: snapshot, advance, snapshot. */
function runWindow(world: World, frames = CONTRACT_WINDOW_FRAMES): { before: unknown; after: unknown } {
  // Cloned on the way out: `state` is the live object the primitives write into, which
  // is what makes L2 honest, and is exactly why a "before" that is not copied would
  // silently be the same object as the "after".
  const before = structuredClone(world.state);
  for (let i = 0; i < frames; i++) world.tick(FRAME);
  return { before, after: structuredClone(world.state) };
}

describe('catalogue -> compiler -> world -> oracle', () => {
  it('satisfies the generated contract for "make it rain"', async () => {
    const world = new World();
    const intent = await compile('make it rain', world);

    mountIntent(world, createPrimitives({ seed: 1 }), intent);
    const { before, after } = runWindow(world);

    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.passed).toBe(true);
    // The contract is not vacuous: WS4 derived one assertion per declared field.
    expect(outcome.results.length).toBe(intent.contract.assertions.length);
    expect(outcome.results.length).toBeGreaterThan(0);
  });

  it('satisfies the generated contract for every single catalogue primitive', async () => {
    // One utterance per entry, chosen from the catalogue's own keywords so the closed
    // set is exercised through the compiler rather than around it.
    const utterances = [
      'make it rain',
      'let it snow',
      'make it windy',
      'add some fog',
      'make it brighter',
      'make it spin',
      'lightning',
    ];

    for (const utterance of utterances) {
      const world = new World();
      const intent = await compile(utterance, world);
      expect(intent.brief.directives.length).toBeGreaterThan(0);

      mountIntent(world, createPrimitives({ seed: 9 }), intent);
      const { before, after } = runWindow(world);

      const outcome = evaluateContract(intent.contract, before, after);
      expect({ utterance, failed: outcome.failedIds }).toEqual({ utterance, failed: [] });
    }
  });

  it('satisfies a multi-primitive contract, with the slices independent', async () => {
    const world = new World();
    // 'storm' is a keyword of both rain-emitter and wind-field: one utterance, two
    // primitives, two disjoint slices, one contract spanning both.
    const intent = await compile('a storm', world);
    expect(intent.scope.length).toBeGreaterThan(1);

    mountIntent(world, createPrimitives({ seed: 4 }), intent);
    const { before, after } = runWindow(world);

    expect(evaluateContract(intent.contract, before, after).failedIds).toEqual([]);
  });

  it('reports the same verdict twice from the same seed, so a nightly run is reproducible', async () => {
    const run = async (): Promise<unknown> => {
      const world = new World();
      const intent = await compile('a storm', world);
      mountIntent(world, createPrimitives({ seed: 77 }), intent);
      const { before, after } = runWindow(world);
      return toVerdict(evaluateContract(intent.contract, before, after));
    };
    expect(await run()).toEqual(await run());
  });
});

describe('AC-09 · L2 rejects state that does not satisfy the contract', () => {
  it('fails the real contract when the real primitive stops being ticked', async () => {
    const world = new World();
    const intent = await compile('make it rain', world);
    mountIntent(world, createPrimitives({ seed: 2 }), intent);

    // The primitive is mounted and every constant is right; it simply never advances.
    // This is "present but inert" produced for real rather than simulated, and the
    // contract has to catch it or the animated tag means nothing.
    const { before, after } = runWindow(world, 0);
    const outcome = evaluateContract(intent.contract, before, after);

    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toEqual(['a:weather.rain.headY']);
    expect(toVerdict(outcome).diagnosis).toContain('present but inert');
  });

  it('fails when a disposed primitive leaves its resource field behind', async () => {
    const world = new World();
    const intent = await compile('add some fog', world);
    const [fog] = mountIntent(world, createPrimitives({ seed: 2 }), intent);

    const before = structuredClone(world.state);
    fog!.dispose();
    const after = structuredClone(world.state);

    // R-4 makes the blob-URL module leak structural, so the live instance handle is
    // the only evidence of disposal L2 can see. After dispose() it is gone, and the
    // contract that asserted it exists now fails — which is what makes a nulled
    // disposer detectable at all.
    const outcome = evaluateContract(intent.contract, before, after);
    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toContain('a:atmosphere.fog.instance');
  });
});

describe('mountIntent · a half-applied intent is never left behind', () => {
  it('unmounts what it already mounted when a later directive cannot be mounted', () => {
    const world = new World();
    const intent = makeIntent({
      brief: {
        goal: 'partly impossible',
        rationale: 'the second directive names a primitive that does not exist',
        directives: [
          {
            name: 'fog-volume',
            importSpecifier: 'verbo:fog-volume',
            statePath: 'atmosphere.fog',
            params: { density: 0.03, color: [0.5, 0.5, 0.5] },
          },
          {
            name: 'lens-flare',
            importSpecifier: 'verbo:lens-flare',
            statePath: 'post.flare',
            params: {},
          },
        ],
        steps: [],
        constraints: [],
      },
    });

    expect(() => mountIntent(world, createPrimitives(), intent)).toThrow(/lens-flare/);
    expect(world.state).toEqual({});
    expect(world.instanceIds).toEqual([]);
  });
});
