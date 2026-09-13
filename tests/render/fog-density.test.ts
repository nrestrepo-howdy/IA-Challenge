/**
 * The fog binding's idea of "maximum density" against the catalogue's.
 *
 * These two numbers were apart for the whole life of the file: the catalogue declared
 * 0.001..0.2 and the binding divided by an implied 1, so every fog the model could ask
 * for rendered as no fog at all. Nothing caught it, because each side was
 * self-consistent — the same shape as the binding-key holes, a contract asserted over
 * state and a renderer reaching into that state by name.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/intent/catalogue.js';
import { FOG_MAX_DENSITY } from '../../src/render/bindings.js';

describe('fog density range', () => {
  it('matches the catalogue the model is given (AC-06)', () => {
    const spec = CATALOGUE.find((c) => c.name === 'fog-volume')!;
    const density = spec.schema.properties['density']!;
    expect(density.type).toBe('number');
    expect('maximum' in density && density.maximum).toBe(FOG_MAX_DENSITY);
  });
});
