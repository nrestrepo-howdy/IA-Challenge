/**
 * Every state key a binding reads, against every key the primitive publishes.
 *
 * This is the one structural hole this codebase kept falling into. A contract is
 * asserted over state; a renderer reaches into that state by string; and nothing
 * connects the two. `slice['colour']` beside a primitive publishing `color` is not a
 * type error, not a runtime error, and not a visible failure — the binding reads
 * `undefined`, falls back to its default, and draws something plausible forever.
 *
 * It has happened five times. Fog pinned to a hard-coded colour because the binding
 * read `colour`; snow drawing rain streaks; `fallHeight` against a published `spread`;
 * `vector` against `direction`; and the fog density range, which was the same mistake
 * in units rather than in spelling. Each was found by eye, late, and only once someone
 * looked at the right frame.
 *
 * So this reads the bindings rather than trusting them. The TypeScript AST gives every
 * `slice['key']` in every binding; mounting the primitive gives every key it actually
 * publishes; and the first is a subset of the second or this fails with both lists.
 * Adding a sixteenth primitive cannot reintroduce the bug without turning this red.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { CATALOGUE, findPrimitive } from '../../src/intent/catalogue.js';
import { createPrimitives } from '../../src/world/index.js';

const SOURCE = fileURLToPath(new URL('../../src/render/bindings.ts', import.meta.url));
const file = ts.createSourceFile(SOURCE, readFileSync(SOURCE, 'utf8'), ts.ScriptTarget.Latest, true);

/** `slice['key']` anywhere under `node`, by the name of the parameter being indexed. */
function keysReadFrom(node: ts.Node, parameter: string): Set<string> {
  const keys = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (
      ts.isElementAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === parameter &&
      ts.isStringLiteralLike(n.argumentExpression)
    ) {
      keys.add(n.argumentExpression.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return keys;
}

/** The `BINDINGS` record, read from the source so this test needs no renderer. */
function bindingVariables(): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'BINDINGS' &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      for (const property of n.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.initializer) &&
          (ts.isStringLiteralLike(property.name) || ts.isIdentifier(property.name))
        ) {
          found.set(property.name.text, property.initializer.text);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

/** The declaration of one binding factory, by variable name. */
function declarationOf(variable: string): ts.VariableDeclaration {
  let found: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === variable) found = n;
    ts.forEachChild(n, visit);
  };
  visit(file);
  if (!found) throw new Error(`no declaration for ${variable}`);
  return found;
}

/**
 * Every key the primitive ever publishes, unioned over its first second of life.
 *
 * Unioned rather than sampled once because a slice may gain a key on the first step —
 * a binding reading it is right to, and a test that looked only at frame zero would
 * call that a hole.
 */
function publishedKeys(name: string): Set<string> {
  const spec = findPrimitive(CATALOGUE, name)!;
  const world = new World();
  createPrimitives({ seed: 11 }).get(name)!.mount(world, { ...spec.defaults });
  const path = spec.statePath.split('.');
  const read = (): Record<string, unknown> => {
    let node = world.state as Record<string, unknown>;
    for (const segment of path) node = node[segment] as Record<string, unknown>;
    return node;
  };
  const keys = new Set(Object.keys(read()));
  for (let i = 0; i < 60; i++) {
    world.tick(1 / 60);
    for (const key of Object.keys(read())) keys.add(key);
  }
  return keys;
}

describe('bindings read only state their primitive publishes', () => {
  const bindings = bindingVariables();

  it('covers every binding the app registers, by catalogue name (AC-06)', () => {
    // Guards the reading, not the bindings: if the parse silently found nothing, every
    // case below would vacuously pass and this file would be decoration.
    expect(bindings.size).toBeGreaterThanOrEqual(12);
    const names = new Set(CATALOGUE.map((c) => c.name));
    expect([...bindings.keys()].filter((n) => !names.has(n))).toEqual([]);
  });

  for (const [primitive, variable] of bindingVariables()) {
    it(`${primitive} (AC-06)`, () => {
      const reads = keysReadFrom(declarationOf(variable), 'slice');
      const published = publishedKeys(primitive);
      const missing = [...reads].filter((key) => !published.has(key));
      expect(missing, `${variable} reads keys ${primitive} never publishes`).toEqual([]);
    });
  }
});
