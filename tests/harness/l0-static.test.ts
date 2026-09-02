import { describe, it, expect } from 'vitest';
import { analyze, evaluateL0 } from '../../src/harness/l0-static.js';
import type { Candidate, Intent } from '../../src/contracts.js';
import { EMPTY_BRIEF } from '../fixtures.js';

const intent: Intent = {
  id: 'i1',
  utterance: 'make it rain',
  allowedPrimitives: ['emitter', 'forceField'],
  scope: ['weather.rain'],
  contract: { id: 'c1', assertions: [], actions: [], mutants: [] },
  brief: EMPTY_BRIEF,
};

const candidate = (source: string): Candidate =>
  ({ id: 'c', intentId: 'i1', strategy: 'test', source });

describe('AC-04 · L0 rejects a module that fails to compile, in < 50 ms', () => {
  it('reports a parse finding rather than throwing', () => {
    const findings = analyze('const x = ;;;', intent);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe('parse');
  });

  it('rejects within the 50 ms budget', () => {
    const v = evaluateL0(candidate('function ('), intent);
    expect(v.passed).toBe(false);
    expect(v.failedAt).toBe('L0');
    expect(v.metrics.compileMs!).toBeLessThan(50);
  });

  it('produces an actionable diagnosis, not a score', () => {
    const v = evaluateL0(candidate('const x = ;'), intent);
    expect(v.diagnosis).toMatch(/\[parse\]/);
  });
});

describe('AC-05 · L0 rejects a module that writes outside its declared scope', () => {
  it('accepts a write inside scope', () => {
    const src = `__VERBO_STATE__.weather.rain.particles = 500;`;
    expect(analyze(src, intent)).toHaveLength(0);
  });

  it('rejects a write outside scope', () => {
    const src = `__VERBO_STATE__.camera.position = [0,0,0];`;
    const f = analyze(src, intent);
    expect(f).toHaveLength(1);
    expect(f[0]!.rule).toBe('out-of-scope-write');
    expect(f[0]!.detail).toContain('camera.position');
  });

  it('rejects registering a primitive at an undeclared state path', () => {
    const src = `world.register(inst, 'terrain.height');`;
    const f = analyze(src, intent);
    expect(f[0]!.rule).toBe('out-of-scope-write');
  });
});

describe('L0 · capability boundary', () => {
  it.each(['eval', 'fetch', 'document', 'WebSocket', 'localStorage'])(
    'rejects use of %s',
    (global) => {
      const f = analyze(`${global};`, intent);
      expect(f.some((x) => x.rule === 'forbidden-global')).toBe(true);
    },
  );

  it('allows an approved primitive import', () => {
    expect(analyze(`import { emitter } from 'verbo:emitter';`, intent)).toHaveLength(0);
  });

  it('rejects a primitive outside the allowed set (D-2: composes, never invents)', () => {
    const f = analyze(`import { x } from 'verbo:physicsSolver';`, intent);
    expect(f[0]!.rule).toBe('import-not-allowed');
  });

  it('rejects any import outside the primitive library', () => {
    const f = analyze(`import * as THREE from 'three';`, intent);
    expect(f[0]!.detail).toContain("only 'verbo:*'");
  });
});
