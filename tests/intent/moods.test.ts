import { describe, it, expect } from 'vitest';
import { MOODS, matchMood } from '../../src/intent/moods.js';
import { CATALOGUE } from '../../src/intent/catalogue.js';
import { CatalogueIntentCompiler, isRejection } from '../../src/intent/compiler.js';
import { fakeWorld } from './support.js';

/**
 * Every mood is hand-written, and the first draft of this file shipped
 * `rain-emitter: { particles: 9000 }` — a parameter that does not exist. The compiler
 * caught it and named the three that do, which is the validator doing its job; but it
 * caught it at *runtime*, on a user's utterance, as a rejection they did not deserve.
 *
 * So the moods are compiled here instead. A mood that names a primitive that does not
 * exist, or a parameter outside its schema, cannot reach a user — it fails the build.
 */
describe('every mood is a composition the catalogue can actually build', () => {
  const compiler = new CatalogueIntentCompiler();
  const names = new Set(CATALOGUE.map((c) => c.name));

  it.each(MOODS.map((m) => [m.triggers[0]!, m] as const))(
    '%s compiles into a real intent',
    async (_trigger, mood) => {
      const r = await compiler.compile(mood.triggers[0]!, fakeWorld());
      if (isRejection(r)) throw new Error(`mood "${mood.triggers[0]}" was rejected: ${r.reason}`);
      expect(r.brief.directives.length).toBeGreaterThan(0);
    },
  );

  it.each(MOODS.flatMap((m) => m.primitives.map((p) => [m.triggers[0]!, p.name] as const)))(
    '%s names an existing primitive: %s',
    (_trigger, name) => {
      expect(names.has(name)).toBe(true);
    },
  );

  it('every parameter a mood sets exists on the primitive it sets it on', () => {
    const wrong: string[] = [];
    for (const mood of MOODS) {
      for (const p of mood.primitives) {
        const spec = CATALOGUE.find((c) => c.name === p.name);
        if (!spec) continue;
        const declared = Object.keys(spec.schema.properties as Record<string, unknown>);
        for (const key of Object.keys(p.params)) {
          if (!declared.includes(key)) wrong.push(`${mood.triggers[0]}: ${p.name}.${key}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('mood matching', () => {
  it('prefers the longest trigger, so a phrase beats a word inside it', () => {
    expect(matchMood('the end of the world')?.rationale).toMatch(/storm/);
  });

  it('is case and punctuation insensitive', () => {
    expect(matchMood('Make this look like BLADE RUNNER!')?.rationale).toMatch(/searchlights/);
  });

  it('returns null when nothing is named, rather than guessing', () => {
    expect(matchMood('compile a kernel')).toBeNull();
    expect(matchMood('')).toBeNull();
  });
});
