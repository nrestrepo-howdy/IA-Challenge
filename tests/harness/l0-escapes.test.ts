import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/harness/l0-static.js';
import { ATTACKS } from '../../src/harness/attacks.js';
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

describe('L0 · the attack corpus', () => {
  // Iterated from `src/harness/attacks.ts` rather than listed here, so this file and
  // `npm run attack` cannot disagree about what the harness claims. They did disagree
  // once, in the direction that matters least and teaches most: two attacks were
  // labelled as escaping and the tool reported on its first run that L0 catches them.
  it.each(ATTACKS.map((a) => [a.name, a] as const))('%s', (_name, attack) => {
    const findings = analyze(attack.source, intent);
    expect(findings.length > 0, `${attack.name}: ${attack.intent}`).toBe(attack.caughtBy === 'L0');
  });

  it('leaves some of them to the worker, and says which', () => {
    // The number is asserted as "more than zero" rather than pinned, because pinning it
    // would make adding an attack a failing test. What must not drift is the claim: L0
    // is a filter, and the corpus contains cases it does not stop.
    expect(ATTACKS.some((a) => a.caughtBy === null)).toBe(true);
    expect(ATTACKS.every((a) => a.intent.length > 0)).toBe(true);
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
