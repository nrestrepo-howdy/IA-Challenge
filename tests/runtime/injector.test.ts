import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world.js';
import { HotInjector, ROLLBACK_WINDOW_MS } from '../../src/runtime/injector.js';
import type { LoadedModule } from '../../src/runtime/loader.js';
import { asLoadedModule, ModuleShapeError } from '../../src/runtime/loader.js';
import {
  candidate,
  explodingModule,
  fakeClock,
  failingVerdict,
  passingVerdict,
  stubModule,
  StubModuleLoader,
  type StubInstance,
} from './support.js';

function setup(options: { budget?: number } = {}) {
  const world = new World();
  const loader = new StubModuleLoader(new Map<string, LoadedModule>());
  const clock = fakeClock(1_000);
  const injector = new HotInjector({
    world,
    loader,
    now: clock.now,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  });
  return { world, loader, clock, injector };
}

describe('AC-13 · an injection that throws inside the rollback window is undone', () => {
  it('restores the world to exactly its prior state', async () => {
    const { world, loader, clock, injector } = setup();
    world.setUserState('camera', { x: 5, y: 2 });

    // A previously accepted verb, so rollback has something to preserve as well as
    // something to remove: undoing one injection must not undo the ones before it.
    const fog = stubModule(world, { id: 'fog-1', statePath: 'weather.fog' });
    loader.set('c-fog', fog.module);
    await injector.inject(candidate({ id: 'c-fog', intentId: 'i-fog' }), passingVerdict('c-fog'));
    world.tick(0.016);
    const before = world.snapshot();

    const rain = stubModule(world, { id: 'rain-1', statePath: 'weather.rain', throwOnTick: 2 });
    loader.set('c-rain', rain.module);
    const injected = await injector.inject(
      candidate({ id: 'c-rain', intentId: 'i-rain' }),
      passingVerdict('c-rain'),
    );
    expect(injected).toEqual({ ok: true, rolledBack: false, reason: null });
    expect(world.snapshot().verbs).toHaveLength(2);

    clock.advance(500);
    world.tick(0.016);
    // The guard turns a throwing primitive into a rollback rather than a stalled frame:
    // R-9 says the user's world must not break because of an injection.
    expect(() => world.tick(0.016)).not.toThrow();
    await injector.settle();

    expect(world.snapshot()).toEqual(before);
    expect(injector.rollbacks).toHaveLength(1);
    expect(injector.rollbacks[0]?.intentId).toBe('i-rain');
    expect(injector.rollbacks[0]?.elapsedMs).toBeLessThanOrEqual(ROLLBACK_WINDOW_MS);
    expect(injector.rollbacks[0]?.reason).toContain('failed on tick 2');
  });

  it('disposes the failed injection and leaves the earlier one running', async () => {
    const { world, loader, clock, injector } = setup();
    const fog = stubModule(world, { id: 'fog-1', statePath: 'weather.fog' });
    loader.set('c-fog', fog.module);
    await injector.inject(candidate({ id: 'c-fog', intentId: 'i-fog' }), passingVerdict('c-fog'));

    const rain = stubModule(world, { id: 'rain-1', statePath: 'weather.rain', throwOnTick: 1 });
    loader.set('c-rain', rain.module);
    await injector.inject(candidate({ id: 'c-rain', intentId: 'i-rain' }), passingVerdict('c-rain'));

    clock.advance(10);
    world.tick(0.016);
    await injector.settle();

    expect(rain.instances[0]?.disposals).toBe(1);
    // Rolling back tears the world down to the snapshot and re-mounts the survivors from
    // their retained modules, so the fog primitive is alive again — a fresh instance.
    expect(world.instanceIds).toEqual(['fog-1']);
    const live = fog.instances[fog.instances.length - 1] as StubInstance;
    world.tick(0.016);
    expect(live.ticks).toBe(1);
    expect(injector.liveCount).toBe(1);
  });

  it('does not roll back a throw that arrives after the window has closed', async () => {
    const { world, loader, clock, injector } = setup();
    const rain = stubModule(world, { id: 'rain-1', statePath: 'weather.rain', throwOnTick: 1 });
    loader.set('c-rain', rain.module);
    await injector.inject(candidate({ id: 'c-rain', intentId: 'i-rain' }), passingVerdict('c-rain'));

    clock.advance(ROLLBACK_WINDOW_MS + 1);
    // Past three seconds the injection is simply part of the world: silently undoing it
    // would hide a live bug rather than fix one.
    expect(() => world.tick(0.016)).toThrow(/failed on tick 1/);
    await injector.settle();
    expect(injector.rollbacks).toHaveLength(0);
    expect(world.instanceIds).toEqual(['rain-1']);
  });

  it('rolls back a module that throws while mounting, before any frame runs', async () => {
    const { world, loader, injector } = setup();
    world.setUserState('camera', { x: 5 });
    const before = world.snapshot();

    loader.set('c-bad', explodingModule('mount blew up'));
    const result = await injector.inject(
      candidate({ id: 'c-bad', intentId: 'i-rain' }),
      passingVerdict('c-bad'),
    );

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toContain('mount blew up');
    expect(world.snapshot()).toEqual(before);
    expect(world.instanceIds).toEqual([]);
    // A failed injection costs no budget: nothing was made permanently resident (R-4).
    expect(injector.remainingBudget).toBe(32);
  });
});

describe('AC-11 · the injector asks the harness, it does not restate the rule', () => {
  it.each(['L0', 'L1', 'L2'] as const)('refuses a verdict that failed %s', async (layer) => {
    const { world, loader, injector } = setup();
    loader.set('c-bad', explodingModule('never reached'));
    const result = await injector.inject(
      candidate({ id: 'c-bad' }),
      failingVerdict('c-bad', layer),
    );
    expect(result).toEqual({
      ok: false,
      rolledBack: false,
      reason: expect.stringContaining(layer) as unknown as string,
    });
    expect(world.instanceIds).toEqual([]);
    expect(loader.loaded).toEqual([]);
  });
});

describe('AC-15 · twenty consecutive injections stay inside the declared budget', () => {
  it('supersedes rather than accumulates, and every superseded instance is disposed', async () => {
    const { world, loader, injector } = setup();
    const mounted: ReturnType<typeof stubModule>[] = [];

    for (let n = 0; n < 20; n += 1) {
      const module = stubModule(world, { id: `rain-${n}`, statePath: 'weather.rain' });
      mounted.push(module);
      loader.set(`c-${n}`, module.module);
      const result = await injector.inject(
        candidate({ id: `c-${n}`, intentId: 'i-rain', source: `// v${n}` }),
        passingVerdict(`c-${n}`),
      );
      expect(result.ok).toBe(true);
      world.tick(0.016);
    }

    // The registry is bounded by distinct intents, not by injection count: one emitter
    // is running, not twenty fighting over one state slice.
    expect(world.instanceIds).toEqual(['rain-19']);
    expect(injector.liveCount).toBe(1);
    expect(injector.disposedCount).toBe(19);
    for (const module of mounted.slice(0, 19)) {
      expect(module.instances[0]?.disposals).toBe(1);
    }
    expect(mounted[19]?.instances[0]?.disposals).toBe(0);

    // Twenty modules are resident and always will be — the leak is structural (R-4), so
    // what the budget bounds is how many of them a session can create (D-6).
    expect(loader.residentCount).toBe(20);
    expect(injector.remainingBudget).toBe(12);
  });

  it('refuses injection past the budget with a reason, instead of leaking quietly', async () => {
    const { world, loader, injector } = setup({ budget: 3 });

    for (let n = 0; n < 3; n += 1) {
      const module = stubModule(world, { id: `rain-${n}`, statePath: 'weather.rain' });
      loader.set(`c-${n}`, module.module);
      expect((await injector.inject(candidate({ id: `c-${n}`, intentId: 'i-rain' }), passingVerdict(`c-${n}`))).ok).toBe(true);
    }
    expect(injector.remainingBudget).toBe(0);

    const extra = stubModule(world, { id: 'rain-x', statePath: 'weather.rain' });
    loader.set('c-x', extra.module);
    const refused = await injector.inject(
      candidate({ id: 'c-x', intentId: 'i-rain' }),
      passingVerdict('c-x'),
    );

    expect(refused.ok).toBe(false);
    expect(refused.rolledBack).toBe(false);
    expect(refused.reason).toMatch(/budget exhausted/);
    // Refused means untouched: the running world is not disturbed by a refusal.
    expect(world.instanceIds).toEqual(['rain-2']);
    expect(loader.residentCount).toBe(3);
  });
});

describe('module shape', () => {
  it('rejects a namespace with no mount export before it can reach the world', () => {
    expect(() => asLoadedModule('c-1', { render: () => {} })).toThrow(ModuleShapeError);
    expect(() => asLoadedModule('c-1', null)).toThrow(ModuleShapeError);
    expect(asLoadedModule('c-1', { mount: () => [] })).toBeTruthy();
  });
});
