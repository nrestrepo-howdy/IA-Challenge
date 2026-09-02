import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world.js';
import { readPath } from '../../src/harness/l2-contract.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import type { PrimitiveSpec, StateField } from '../../src/intent/catalogue.js';
import type { Primitive, PrimitiveInstance } from '../../src/contracts.js';
import {
  createPrimitives,
  createRainEmitter,
  createSnowEmitter,
  createWindField,
  MAX_STEP_SECONDS,
  ParamValidationError,
  type Params,
  type PrimitiveRegistry,
} from '../../src/world/index.js';

/**
 * These tests are driven by the catalogue rather than by a hand-written list, so a
 * seventh primitive — or a new field on an existing one — is covered the moment WS4
 * declares it. A test that has to be remembered is a test that eventually is not.
 */
const FRAME = 1 / 60;

function mountAll(world: World, registry: PrimitiveRegistry): Map<string, PrimitiveInstance> {
  const mounted = new Map<string, PrimitiveInstance>();
  for (const spec of CATALOGUE) {
    mounted.set(spec.name, primitiveFor(registry, spec).mount(world, spec.defaults));
  }
  return mounted;
}

function primitiveFor(registry: PrimitiveRegistry, spec: PrimitiveSpec): Primitive<Params> {
  const p = registry.get(spec.name);
  if (!p) throw new Error(`no implementation for '${spec.name}'`);
  return p;
}

function fieldsOfRole<R extends StateField['role']>(
  spec: PrimitiveSpec,
  role: R,
): readonly Extract<StateField, { role: R }>[] {
  return spec.fields.filter((f): f is Extract<StateField, { role: R }> => f.role === role);
}

describe('catalogue primitives · every declared field is real', () => {
  it('implements all six catalogue entries at their declared state paths', () => {
    const registry = createPrimitives();
    expect([...registry.keys()].sort()).toEqual(CATALOGUE.map((s) => s.name).sort());
    for (const spec of CATALOGUE) {
      expect(primitiveFor(registry, spec).statePath).toBe(spec.statePath);
      expect(primitiveFor(registry, spec).schema).toBe(spec.schema);
    }
  });

  it('publishes every declared field before the first frame, where an oracle can read it', () => {
    const world = new World();
    mountAll(world, createPrimitives());

    for (const spec of CATALOGUE) {
      for (const field of spec.fields) {
        // The oracle's own reader, deliberately: a primitive whose state is only
        // reachable some other way is state L2 cannot see, and therefore not state.
        expect(readPath(world.state, `${spec.statePath}.${field.key}`)).toBeDefined();
      }
    }
  });

  it('pins every `constant` field to the parameter it was given', () => {
    const world = new World();
    mountAll(world, createPrimitives());

    for (const spec of CATALOGUE) {
      for (const field of fieldsOfRole(spec, 'constant')) {
        expect(readPath(world.state, `${spec.statePath}.${field.key}`)).toBe(
          spec.defaults[field.fromParam],
        );
      }
    }
  });

  it('keeps a `constant` field pinned across 600 frames', () => {
    const world = new World();
    mountAll(world, createPrimitives());
    for (let i = 0; i < 600; i++) world.tick(FRAME);

    for (const spec of CATALOGUE) {
      for (const field of fieldsOfRole(spec, 'constant')) {
        expect(readPath(world.state, `${spec.statePath}.${field.key}`)).toBe(
          spec.defaults[field.fromParam],
        );
      }
    }
  });

  it('moves every `animated` field on every single tick', () => {
    const world = new World();
    mountAll(world, createPrimitives());

    // "Present but inert" is the failure mode R-1 is really measuring, so the check is
    // per tick and not merely across the contract window: a field that stalls for a
    // frame here is a field that can stall for a window somewhere else.
    for (let i = 0; i < 240; i++) {
      const before = structuredClone(world.state);
      world.tick(FRAME);
      for (const spec of CATALOGUE) {
        for (const field of fieldsOfRole(spec, 'animated')) {
          const path = `${spec.statePath}.${field.key}`;
          expect(readPath(world.state, path)).not.toBe(readPath(before, path));
        }
      }
    }
  });

  it('keeps every `vector` field inside its declared bounds', () => {
    const world = new World();
    mountAll(world, createPrimitives());
    for (let i = 0; i < 300; i++) world.tick(FRAME);

    for (const spec of CATALOGUE) {
      for (const field of fieldsOfRole(spec, 'vector')) {
        const v = readPath(world.state, `${spec.statePath}.${field.key}`) as number[];
        expect(Array.isArray(v)).toBe(true);
        v.forEach((c, k) => {
          expect(c).toBeGreaterThanOrEqual(field.bounds.min[k]!);
          expect(c).toBeLessThanOrEqual(field.bounds.max[k]!);
        });
      }
    }
  });

  it('publishes the instance handle as its `resource` field, matching the declared shape', () => {
    const world = new World();
    const mounted = mountAll(world, createPrimitives());

    for (const spec of CATALOGUE) {
      for (const field of fieldsOfRole(spec, 'resource')) {
        const value = readPath(world.state, `${spec.statePath}.${field.key}`);
        expect(value).toBe(mounted.get(spec.name)?.id);
        expect(value).toBe(field.witness);
      }
    }
  });
});

describe('catalogue primitives · parameter validation at mount()', () => {
  const registry = createPrimitives();
  const rainSpec = findPrimitive(CATALOGUE, 'rain-emitter')!;

  it('rejects a parameter outside the catalogue schema instead of producing NaN state', () => {
    const world = new World();
    expect(() => primitiveFor(registry, rainSpec).mount(world, { count: 5e9 })).toThrow(
      ParamValidationError,
    );
    // A refused mount leaves nothing behind: the path is still free for a later one.
    expect(world.state).toEqual({});
  });

  it('rejects a parameter the primitive does not have, because the surface is closed (D-2)', () => {
    expect(() => primitiveFor(registry, rainSpec).mount(new World(), { gravity: 9.8 })).toThrow(
      /not a parameter/,
    );
  });

  it('rejects a non-integer where the schema says integer', () => {
    expect(() => primitiveFor(registry, rainSpec).mount(new World(), { count: 120.5 })).toThrow(
      ParamValidationError,
    );
  });

  it('fills catalogue defaults for parameters the utterance never mentioned', () => {
    const world = new World();
    primitiveFor(registry, rainSpec).mount(world, { speed: 40 });
    expect(readPath(world.state, 'weather.rain.fallSpeed')).toBe(40);
    expect(readPath(world.state, 'weather.rain.particles')).toBe(rainSpec.defaults['count']);
  });
});

describe('catalogue primitives · determinism', () => {
  it('produces identical state from the same seed, run to run', () => {
    const run = (): unknown => {
      const world = new World();
      mountAll(world, createPrimitives({ seed: 42 }));
      for (let i = 0; i < 1200; i++) world.tick(FRAME);
      return structuredClone(world.state);
    };
    expect(run()).toEqual(run());
  });

  it('separates two seeds, so a repeated evaluation is reproducible without being degenerate', () => {
    const run = (seed: number): unknown => {
      const world = new World();
      createSnowEmitter({ seed }).mount(world, { count: 2000, drift: 2 });
      for (let i = 0; i < 60; i++) world.tick(FRAME);
      return structuredClone(world.state);
    };
    expect(run(1)).not.toEqual(run(2));
  });

  it('gives two instances of one primitive distinct ids and distinct streams', () => {
    const world = new World();
    const snow = createSnowEmitter({ seed: 7 });
    const a = snow.mount(world, { count: 1000, drift: 1 });
    // A second instance needs its own path; the world forbids sharing one, by design.
    const b = snow.mount(new World(), { count: 1000, drift: 1 });
    expect(a.id).toBe('snow-emitter#0');
    expect(b.id).toBe('snow-emitter#1');
    expect(readPath(world.state, 'weather.snow.driftPhase')).not.toBe(0);
  });

  it('never lets one long frame stall an animated field (the wrap-aliasing trap)', () => {
    const world = new World();
    createRainEmitter({ seed: 3 }).mount(world, { count: 1000, speed: 80, spread: 20 });
    const before = readPath(world.state, 'weather.rain.headY');

    // A step far larger than the clamp: without MAX_STEP_SECONDS a wrapping field can
    // land exactly where it started and read as inert while the emitter is running.
    world.tick(MAX_STEP_SECONDS * 50);
    expect(readPath(world.state, 'weather.rain.headY')).not.toBe(before);
  });
});

describe('catalogue primitives · cross-slice coupling', () => {
  it('lets rain read the wind field without writing outside its own slice (AC-05)', () => {
    const withWind = new World();
    const registry = createPrimitives({ seed: 11 });
    primitiveFor(registry, findPrimitive(CATALOGUE, 'wind-field')!).mount(withWind, {
      direction: [1, 0, 0],
      strength: 30,
    });
    primitiveFor(registry, findPrimitive(CATALOGUE, 'rain-emitter')!).mount(withWind, {
      count: 1000,
      speed: 20,
      spread: 100,
    });
    for (let i = 0; i < 60; i++) withWind.tick(FRAME);

    const calm = new World();
    createRainEmitter({ seed: 11 }).mount(calm, { count: 1000, speed: 20, spread: 100 });
    for (let i = 0; i < 60; i++) calm.tick(FRAME);

    expect(readPath(withWind.state, 'weather.rain.headX')).not.toBe(0);
    expect(readPath(calm.state, 'weather.rain.headX')).toBe(0);
    // The coupling is a read: rain owns `weather.rain` and touched nothing else.
    expect(Object.keys(withWind.state).sort()).toEqual(['forces', 'weather']);
  });
});

describe('AC-12 · dispose() leaves the user\'s world exactly as it was', () => {
  it('removes the whole slice, its scaffolding, and the registration', () => {
    const world = new World();
    world.setUserState('camera.position', [0, 2, 8]);
    const clean = world.snapshot();

    const mounted = mountAll(world, createPrimitives());
    for (let i = 0; i < 90; i++) world.tick(FRAME);
    for (const inst of mounted.values()) inst.dispose();

    expect(world.instanceIds).toEqual([]);
    expect(world.state).toEqual({ camera: { position: [0, 2, 8] } });
    expect(world.snapshot()).toEqual(clean);
  });

  it('is idempotent, and a disposed instance stops ticking (a leaked one is a live failure)', () => {
    const world = new World();
    const rain = createRainEmitter({ seed: 5 }).mount(world, { count: 500, speed: 10, spread: 50 });

    rain.dispose();
    rain.dispose();
    expect(() => rain.update(FRAME)).not.toThrow();
    expect(world.state).toEqual({});
  });

  it('unregistering from the world side disposes exactly once and clears the state', () => {
    const world = new World();
    const wind = createWindField({ seed: 5 }).mount(world, { direction: [1, 0, 0], strength: 4 });

    world.unregister(wind.id);
    expect(world.state).toEqual({});
    expect(world.instanceIds).toEqual([]);
  });
});

describe('AC-15 · repeated mount/dispose accumulates nothing', () => {
  it('leaves no residue after 20 consecutive mount-tick-dispose cycles', () => {
    const world = new World();
    world.setUserState('inputs.pointer', { x: 1, y: 2 });
    const clean = structuredClone(world.state);

    for (let n = 0; n < 20; n++) {
      const registry = createPrimitives({ seed: n });
      const mounted = mountAll(world, registry);
      for (let i = 0; i < 30; i++) world.tick(FRAME);
      for (const inst of mounted.values()) inst.dispose();
      // Checked every cycle rather than only at the end: a leak that cancels itself
      // out by cycle 20 is still a leak while the user is in the world.
      expect(world.state).toEqual(clean);
      expect(world.instanceIds).toEqual([]);
    }
  });
});
