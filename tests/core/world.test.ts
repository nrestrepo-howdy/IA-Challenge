import { describe, it, expect } from 'vitest';
import { World, PathOwnershipError } from '../../src/core/world.js';
import { readPath } from '../../src/harness/l2-contract.js';
import type { PrimitiveInstance, WorldSnapshot } from '../../src/contracts.js';

/**
 * A primitive stand-in. WS5 brings the Three.js ones; nothing here needs a renderer,
 * which is the point — the layer that decides correctness stays testable in Node.
 */
function fakeInstance(
  id: string,
  onUpdate: (dt: number) => void = () => {},
  onDispose: () => void = () => {},
): PrimitiveInstance {
  return { id, update: onUpdate, dispose: onDispose };
}

/** Registers an instance that counts frames into its own slice. */
function mountCounter(world: World, id: string, path: string): PrimitiveInstance {
  const inst = fakeInstance(id, (dt) => {
    const s = world.slice(id);
    s['frames'] = (s['frames'] as number) + 1;
    s['t'] = (s['t'] as number) + dt;
  });
  world.register(inst, path);
  Object.assign(world.slice(id), { frames: 0, t: 0 });
  return inst;
}

describe('World · state registry', () => {
  it('exposes a registered slice at its dotted path, readable by the L2 oracle', () => {
    const world = new World();
    mountCounter(world, 'rain-1', 'weather.rain');
    Object.assign(world.slice('rain-1'), { particles: 4000 });

    // The oracle's own reader is used deliberately: if these two ever disagree, L2
    // asserts over paths that do not exist and every contract silently passes on air.
    expect(readPath(world.state, 'weather.rain.particles')).toBe(4000);
    expect(readPath(world.state, 'weather.rain')).toBe(world.slice('rain-1'));
  });

  it('rejects a second primitive claiming an owned path', () => {
    const world = new World();
    mountCounter(world, 'rain-1', 'weather.rain');
    expect(() => world.register(fakeInstance('rain-2'), 'weather.rain')).toThrow(
      PathOwnershipError,
    );
  });

  it('rejects a path that nests inside an owned one, in either direction', () => {
    const world = new World();
    mountCounter(world, 'rain-1', 'weather.rain');
    expect(() => world.register(fakeInstance('drops'), 'weather.rain.particles')).toThrow(
      PathOwnershipError,
    );
    expect(() => world.register(fakeInstance('all'), 'weather')).toThrow(PathOwnershipError);
  });

  it('leaves the loser of a path conflict unregistered rather than half-mounted', () => {
    const world = new World();
    mountCounter(world, 'rain-1', 'weather.rain');
    expect(() => world.register(fakeInstance('rain-2'), 'weather.rain')).toThrow();
    expect(world.instanceIds).toEqual(['rain-1']);
  });

  it('rejects a duplicate instance id', () => {
    const world = new World();
    mountCounter(world, 'rain-1', 'weather.rain');
    expect(() => world.register(fakeInstance('rain-1'), 'weather.fog')).toThrow(/already/);
  });

  it('rejects a path already occupied by unregistered state', () => {
    const world = new World();
    world.setUserState('weather.rain', { particles: 1 });
    expect(() => world.register(fakeInstance('rain-1'), 'weather.rain')).toThrow(
      PathOwnershipError,
    );
  });

  it('rejects a malformed path instead of creating an empty key', () => {
    const world = new World();
    expect(() => world.register(fakeInstance('x'), 'weather..rain')).toThrow(/invalid state path/);
    expect(() => world.register(fakeInstance('y'), '')).toThrow(/invalid state path/);
  });
});

describe('World · disposal', () => {
  it('disposes the instance and removes its slice on unregister (R-4)', () => {
    const world = new World();
    let disposed = 0;
    world.register(fakeInstance('rain-1', () => {}, () => { disposed++; }), 'weather.rain');

    world.unregister('rain-1');

    expect(disposed).toBe(1);
    expect(readPath(world.state, 'weather.rain')).toBeUndefined();
  });

  it('stops ticking a disposed instance — a leaked instance still running is the failure', () => {
    const world = new World();
    let updates = 0;
    world.register(fakeInstance('rain-1', () => { updates++; }), 'weather.rain');

    world.tick(0.016);
    world.unregister('rain-1');
    world.tick(0.016);

    expect(updates).toBe(1);
  });

  it('frees the path so a replacement primitive may claim it', () => {
    const world = new World();
    mountCounter(world, 'rain-1', 'weather.rain');
    world.unregister('rain-1');
    expect(() => mountCounter(world, 'rain-2', 'weather.rain')).not.toThrow();
  });

  it('is a no-op for an unknown id', () => {
    const world = new World();
    expect(() => world.unregister('nobody')).not.toThrow();
  });
});

describe('World · frame tick', () => {
  it('advances the clock and updates every instance', () => {
    const world = new World();
    mountCounter(world, 'rain-1', 'weather.rain');
    mountCounter(world, 'wind-1', 'weather.wind');

    world.tick(0.5);
    world.tick(0.25);

    expect(world.clock.elapsed).toBeCloseTo(0.75);
    expect(readPath(world.state, 'weather.rain.frames')).toBe(2);
    expect(readPath(world.state, 'weather.wind.t')).toBeCloseTo(0.75);
  });

  it('updates in registration order, so replays are reproducible', () => {
    const world = new World();
    const order: string[] = [];
    world.register(fakeInstance('a', () => order.push('a')), 'p.a');
    world.register(fakeInstance('b', () => order.push('b')), 'p.b');
    world.register(fakeInstance('c', () => order.push('c')), 'p.c');

    world.tick(0.016);
    world.tick(0.016);

    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(world.instanceIds).toEqual(['a', 'b', 'c']);
  });

  it('finishes the frame before rethrowing, so one bad instance cannot starve the rest', () => {
    const world = new World();
    world.register(fakeInstance('boom', () => { throw new Error('candidate threw'); }), 'p.boom');
    let ticked = 0;
    world.register(fakeInstance('ok', () => { ticked++; }), 'p.ok');

    expect(() => world.tick(0.016)).toThrow('candidate threw');
    expect(ticked).toBe(1);
  });
});

describe('AC-12 · after an injection, prior user state is identical', () => {
  /** A world mid-session: user state plus one already-injected primitive. */
  function seeded(): World {
    const world = new World();
    world.setUserState('camera', { position: [0, 2, 8], target: [0, 0, 0] });
    world.setUserState('input.pointerLocked', true);
    world.setUserState('objects.created', [{ id: 'box-1', kind: 'box' }]);
    mountCounter(world, 'rain-1', 'weather.rain');
    world.tick(0.016);
    return world;
  }

  it('adding a primitive leaves unrelated state identical', () => {
    const world = seeded();
    const before = structuredClone(world.snapshot().userState);
    const rainBefore = structuredClone(world.slice('rain-1'));

    mountCounter(world, 'fog-1', 'weather.fog');

    expect(world.snapshot().userState).toEqual(before);
    expect(world.slice('rain-1')).toEqual(rainBefore);
  });

  it('replacing a primitive in place leaves unrelated state identical', () => {
    const world = seeded();
    mountCounter(world, 'fog-1', 'weather.fog');
    world.tick(0.016);
    const before = structuredClone(world.snapshot().userState);
    const fogBefore = structuredClone(world.slice('fog-1'));

    world.unregister('rain-1');
    mountCounter(world, 'rain-2', 'weather.rain');

    expect(world.snapshot().userState).toEqual(before);
    expect(world.slice('fog-1')).toEqual(fogBefore);
  });

  it('a rejected registration disturbs nothing at all', () => {
    const world = seeded();
    const before = structuredClone(world.state);

    expect(() => world.register(fakeInstance('rain-2'), 'weather.rain')).toThrow();

    expect(world.state).toEqual(before);
  });

  it('unregistering removes the slice and nothing else — including its own container', () => {
    const world = seeded();
    const before = structuredClone(world.snapshot().userState);

    world.unregister('rain-1');

    // 'weather' was created for the slice, so it goes too: the tree returns to the
    // exact shape it had before the injection, which is what "identical" means.
    expect(world.state).toEqual(before);
  });

  it('keeps a container that also holds user state', () => {
    const world = new World();
    world.setUserState('weather.userPreset', 'clear');
    mountCounter(world, 'rain-1', 'weather.rain');

    world.unregister('rain-1');

    expect(readPath(world.state, 'weather.userPreset')).toBe('clear');
  });

  it('refuses to let user state overwrite a primitive-owned path', () => {
    const world = seeded();
    expect(() => world.setUserState('weather.rain.particles', 0)).toThrow(PathOwnershipError);
  });
});

describe('AC-20 · a world serializes and restores with the same verbs applied', () => {
  function authored(): World {
    const world = new World();
    world.setUserState('camera', { position: [1, 2, 3] });
    world.recordVerb({ intentId: 'i-1', utterance: 'make it rain', source: 'export const m=1' });
    mountCounter(world, 'rain-1', 'weather.rain');
    world.tick(0.016);
    return world;
  }

  it('round-trips verbs and user state into a fresh world', () => {
    const source = authored();
    const snap = source.snapshot();

    const restored = new World();
    restored.restore(snap);

    expect(restored.verbs).toEqual(snap.verbs);
    expect(readPath(restored.state, 'camera.position')).toEqual([1, 2, 3]);
  });

  it('snapshots identically once the same verbs are applied', () => {
    const source = authored();
    const snap = source.snapshot();

    const restored = new World();
    restored.restore(snap);
    // Replaying a verb is WS2's job (it loads the module); the world's part is that
    // the same primitive re-registers onto the same path and the result matches.
    mountCounter(restored, 'rain-1', 'weather.rain');
    restored.tick(0.016);

    expect(restored.snapshot()).toEqual(snap);
    expect(restored.state).toEqual(source.state);
  });

  it('is serializable as a link payload — JSON in, JSON out', () => {
    const snap = authored().snapshot();
    const wire = JSON.parse(JSON.stringify(snap)) as WorldSnapshot;

    const restored = new World();
    restored.restore(wire);

    expect(restored.snapshot()).toEqual(snap);
  });

  it('a snapshot is a copy: mutating the world afterwards does not edit it', () => {
    const world = authored();
    const snap = world.snapshot();

    world.setUserState('camera', { position: [9, 9, 9] });
    world.recordVerb({ intentId: 'i-2', utterance: 'add fog', source: '' });

    expect(readPath(snap.userState, 'camera.position')).toEqual([1, 2, 3]);
    expect(snap.verbs).toHaveLength(1);
  });

  it('restoring disposes whatever was mounted, so nothing survives from the old world', () => {
    const world = authored();
    let disposed = 0;
    world.register(fakeInstance('fog-1', () => {}, () => { disposed++; }), 'weather.fog');

    world.restore(new World().snapshot());

    expect(disposed).toBe(1);
    expect(world.instanceIds).toEqual([]);
    expect(world.state).toEqual({});
  });

  it('refuses a snapshot from a version it does not understand', () => {
    const world = new World();
    const alien = { ...world.snapshot(), version: 2 } as unknown as WorldSnapshot;
    expect(() => world.restore(alien)).toThrow(/version/);
  });
});
