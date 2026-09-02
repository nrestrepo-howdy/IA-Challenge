import { describe, expect, it } from 'vitest';
import { hardenContract } from '../../src/harness/mutation.js';
import { evaluateContract } from '../../src/harness/l2-contract.js';
import { CATALOGUE, type PrimitiveSpec } from '../../src/intent/catalogue.js';
import { CatalogueIntentCompiler, isRejection } from '../../src/intent/compiler.js';
import { buildContract, buildWitness } from '../../src/intent/contract.js';
import { fakeWorld, stubModel } from './support.js';

const world = fakeWorld({});

describe('AC-16 · the contract half of every intent is sound (AC-10)', () => {
  it('hardens every contract the catalogue can produce', () => {
    for (const spec of CATALOGUE) {
      const selections = [{ spec, params: spec.defaults }];
      const contract = buildContract(`c-${spec.name}`, selections);
      const { before, after } = buildWitness(selections);

      expect(contract.mutants.length, `${spec.name} nominates no mutants`).toBeGreaterThan(0);
      // The unmutated state must pass, or the contract is asserting something the
      // primitive was never going to do.
      expect(evaluateContract(contract, before, after).passed).toBe(true);

      const report = hardenContract(contract, before, after);
      expect(report.escaped, `${spec.name}: ${report.reason}`).toEqual([]);
      expect(report.hardened).toBe(true);
    }
  });

  it('covers all four catalogued failure modes across the catalogue', () => {
    const kinds = new Set(
      CATALOGUE.flatMap((spec) =>
        buildContract('c', [{ spec, params: spec.defaults }]).mutants.map((m) => m.kind),
      ),
    );
    expect([...kinds].sort()).toEqual(
      ['corruptConstant', 'dropStateUpdate', 'nullifyDisposer', 'swapEventTarget'].sort(),
    );
  });

  it('pins constants strongly enough to catch a corrupted one, which `exists` cannot', () => {
    const rain = CATALOGUE.find((p) => p.name === 'rain-emitter')!;
    const selections = [{ spec: rain, params: rain.defaults }];
    const contract = buildContract('c-rain', selections);
    const { before, after } = buildWitness(selections);

    const corrupted = structuredClone(after) as any;
    corrupted.weather.rain.particles = 4_000_001;
    const outcome = evaluateContract(contract, before, corrupted);
    expect(outcome.passed).toBe(false);
    expect(outcome.failedIds).toContain('a:weather.rain.particles');
  });

  it('catches a scene that is present but inert', () => {
    const rain = CATALOGUE.find((p) => p.name === 'rain-emitter')!;
    const selections = [{ spec: rain, params: rain.defaults }];
    const contract = buildContract('c-rain', selections);
    const { before } = buildWitness(selections);

    // Nothing moved between the snapshots: the dominant real failure behind R-1.
    const outcome = evaluateContract(contract, before, structuredClone(before));
    expect(outcome.failedIds).toContain('a:weather.rain.headY');
  });

  it('refuses to emit an intent whose contract cannot be hardened', async () => {
    // A malformed catalogue entry: the field is pinned to a parameter that does not
    // exist, so `equals undefined` survives the schema-drift mutant. The compiler must
    // reject rather than ship a contract that would rubber-stamp L2.
    const unsound: PrimitiveSpec = {
      name: 'ghost-field',
      summary: 'a field pinned to a parameter that does not exist',
      statePath: 'ghost.slice',
      schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      defaults: {},
      keywords: ['ghost'],
      fields: [{ key: 'value', role: 'constant', fromParam: 'missing' }],
    };
    const compiler = new CatalogueIntentCompiler({
      catalogue: [unsound],
      model: stubModel({ primitives: [{ name: 'ghost-field' }] }),
    });

    const result = await compiler.compile('summon a ghost', world);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toContain('sound state contract could not be generated');
  });

  it('hardens the contract of a multi-primitive intent too', async () => {
    const compiler = new CatalogueIntentCompiler({
      model: stubModel({ primitives: [{ name: 'rain-emitter' }, { name: 'wind-field' }, { name: 'fog-volume' }] }),
    });
    const result = await compiler.compile('make it a miserable day', world);
    expect(isRejection(result)).toBe(false);
    if (isRejection(result)) return;

    const selections = result.brief.directives.map((d) => ({
      spec: CATALOGUE.find((p) => p.name === d.name)!,
      params: d.params,
    }));
    const { before, after } = buildWitness(selections);
    expect(hardenContract(result.contract, before, after).hardened).toBe(true);
  });
});
