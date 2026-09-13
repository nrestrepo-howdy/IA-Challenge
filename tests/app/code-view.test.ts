/**
 * The diff behind the panel's source view.
 *
 * These run in plain Node against the *real* strategies from WS2, not against pasted
 * strings: the claim the panel makes is "these three programs differ", and a test that
 * diffed two fixtures would verify the differ while leaving the claim unchecked.
 */
import { describe, expect, it } from 'vitest';
import { diffAgainst, splitLines, summarise } from '../../src/app/code-view.js';
import { directStrategy, resilientStrategy, reversedStrategy } from '../../src/runtime/generate.js';
import type { CodeBrief } from '../../src/contracts.js';

function brief(names: readonly string[]): CodeBrief {
  return {
    goal: 'make it rain',
    rationale: 'matched on catalogue keywords',
    directives: names.map((name) => ({
      name,
      importSpecifier: `verbo:${name}`,
      statePath: `weather.${name}`,
      params: { count: 4000 },
    })),
    steps: [],
    constraints: [],
  };
}

describe('the source shown in the verification panel', () => {
  it('leaves the base candidate unmarked', () => {
    const source = directStrategy.emit(brief(['rain-emitter']), 0);
    const lines = diffAgainst(null, source);
    expect(lines.every((l) => l.kind === 'same')).toBe(true);
    expect(lines.map((l) => l.text)).toEqual(splitLines(source));
    expect(summarise(lines, true)).toBe('base');
  });

  it('keeps every line of the candidate, so the block is still the module', () => {
    const one = brief(['rain-emitter']);
    const lines = diffAgainst(directStrategy.emit(one, 0), resilientStrategy.emit(one, 0));
    const kept = lines.filter((l) => l.kind !== 'del').map((l) => l.text);
    expect(kept).toEqual(splitLines(resilientStrategy.emit(one, 0)));
  });

  it('counts what the resilient strategy adds and drops', () => {
    const one = brief(['rain-emitter']);
    const lines = diffAgainst(directStrategy.emit(one, 0), resilientStrategy.emit(one, 0));
    expect(lines.some((l) => l.kind === 'add')).toBe(true);
    expect(lines.some((l) => l.kind === 'del')).toBe(true);
    // try/catch, the failure list and the all-failed throw, against the two lines the
    // direct template writes in their place.
    expect(summarise(lines, false)).toMatch(/^\+\d+ −\d+$/);
  });

  it('says "identical" rather than flattering a one-directive brief', () => {
    // reversedStrategy reverses the directive list. With one directive that is the
    // same list, so it emits the same bytes — and the panel has to say so.
    const one = brief(['rain-emitter']);
    const lines = diffAgainst(directStrategy.emit(one, 0), reversedStrategy.emit(one, 0));
    expect(summarise(lines, false)).toBe('identical');
  });

  it('shows the reordering when there is more than one directive', () => {
    const two = brief(['rain-emitter', 'fog-volume']);
    const lines = diffAgainst(directStrategy.emit(two, 0), reversedStrategy.emit(two, 0));
    expect(summarise(lines, false)).not.toBe('identical');
    // Order is the whole of what reversed changes: every moved line is an import or a
    // mount, and no new logic appears. That is the claim D-5 makes about this strategy.
    const moved = lines.filter((l) => l.kind === 'add');
    expect(moved.every((l) => /^import |mounted\.push/.test(l.text.trim()) || l.text.startsWith('import'))).toBe(true);
    expect(moved.some((l) => l.text.includes('mounted.push'))).toBe(true);
  });

  it('ignores trailing blank lines, which are a template artefact', () => {
    expect(splitLines('a\nb\n\n')).toEqual(['a', 'b']);
    expect(diffAgainst('a\nb', 'a\nb\n')).toHaveLength(2);
  });
});
