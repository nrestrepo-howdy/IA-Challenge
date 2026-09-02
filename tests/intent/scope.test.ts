import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/harness/l0-static.js';
import { CatalogueIntentCompiler, isRejection, type CompiledIntent } from '../../src/intent/compiler.js';
import { keywordModel } from '../../src/intent/model.js';
import { fakeWorld } from './support.js';

/**
 * The intent is what L0 checks candidates against, so the scope it declares has to be
 * usable by the real static oracle rather than merely well-formed. This is the seam
 * between WS4 and WS3, tested across it.
 */
async function rainIntent(): Promise<CompiledIntent> {
  const compiler = new CatalogueIntentCompiler({ model: keywordModel });
  const result = await compiler.compile('make it rain', fakeWorld({}));
  if (isRejection(result)) throw new Error(result.reason);
  return result;
}

describe('AC-05 · the scope an intent declares drives L0 (AC-16)', () => {
  it('admits a module that writes only inside the declared scope', async () => {
    const intent = await rainIntent();
    const source = [
      "import { rainEmitter } from 'verbo:rain-emitter';",
      'export function mount(world) {',
      '  const inst = rainEmitter(world, { count: 4000 });',
      "  world.register(inst, 'weather.rain');",
      '  __VERBO_STATE__.weather.rain.headY = 300;',
      '  return inst;',
      '}',
    ].join('\n');

    expect(analyze(source, intent)).toEqual([]);
  });

  it('rejects a write outside the declared scope and an uncatalogued import', async () => {
    const intent = await rainIntent();
    const source = [
      "import { dragon } from 'verbo:dragon-emitter';",
      'export function mount() {',
      '  __VERBO_STATE__.lighting.ambient.intensity = 4;',
      '}',
    ].join('\n');

    const rules = analyze(source, intent).map((f) => f.rule);
    expect(rules).toContain('import-not-allowed');
    expect(rules).toContain('out-of-scope-write');
  });
});
