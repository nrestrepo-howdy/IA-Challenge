/**
 * The closed primitive catalogue (D-2).
 *
 * R-1 is the whole reason this file exists: the state of the art writes behaviourally
 * correct Three.js roughly 28% of the time, so the compiler never lets a model invent
 * a primitive. It resolves an utterance against *this list* or rejects (AC-17).
 *
 * The catalogue is data, not code. WS5 implements the actual `Primitive` objects
 * against these entries — a `PrimitiveSpec` is exactly the declarative half of
 * `Primitive` (name, schema, statePath) with `mount()` left to WS5. Keeping it as
 * data is what lets WS4 be built and tested with no renderer in the repo at all.
 *
 * Each entry also declares the *observable fields* of its state slice, tagged with the
 * kind of evidence each can give. Those tags are what make a machine-checkable
 * contract derivable rather than guessed: see contract.ts for the
 * role → assertion → mutant mapping.
 */

/** The JSON Schema subset the catalogue uses. Deliberately small — see schema.ts. */
export interface ParamSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, PropertySchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export type PropertySchema =
  | { readonly type: 'number' | 'integer'; readonly minimum: number; readonly maximum: number }
  | { readonly type: 'string'; readonly enum: readonly string[] }
  | {
      readonly type: 'array';
      readonly items: { readonly type: 'number'; readonly minimum: number; readonly maximum: number };
      readonly minItems: number;
      readonly maxItems: number;
    };

/**
 * A field of `__VERBO_STATE__` that a primitive maintains, tagged with what kind of
 * evidence it can provide.
 *
 *  - `constant` — pinned to a parameter. Proves the code used the value it was asked for.
 *  - `animated` — must move between snapshots. This is the tag that catches "present
 *    but inert", the dominant real failure mode behind R-1.
 *  - `vector`   — must stay inside its declared volume.
 *  - `resource` — the registered instance handle. Its presence in state is the only
 *    way a nulled `dispose()` becomes visible to L2 at all (R-4).
 */
export type StateField =
  | { readonly key: string; readonly role: 'constant'; readonly fromParam: string }
  | {
      readonly key: string;
      readonly role: 'vector';
      readonly fromParam: string;
      readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] };
    }
  | { readonly key: string; readonly role: 'animated'; readonly witness: readonly [unknown, unknown] }
  | { readonly key: string; readonly role: 'resource'; readonly witness: unknown };

export interface PrimitiveSpec {
  readonly name: string;
  readonly summary: string;
  /** JSON Schema. L0 validates parameters against it before anything runs. */
  readonly schema: ParamSchema;
  /** The slice of `__VERBO_STATE__` this primitive owns. Becomes the intent's scope. */
  readonly statePath: string;
  readonly defaults: Readonly<Record<string, unknown>>;
  /** Resolution hints for the offline model. A ranking signal, not a parser. */
  readonly keywords: readonly string[];
  readonly fields: readonly StateField[];
}

const UNIT_RGB = { min: [0, 0, 0], max: [1, 1, 1] } as const;

export const CATALOGUE: readonly PrimitiveSpec[] = [
  {
    name: 'rain-emitter',
    summary: 'Falling precipitation with wind-coupled streaks.',
    statePath: 'weather.rain',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 100, maximum: 20000 },
        speed: { type: 'number', minimum: 1, maximum: 80 },
        spread: { type: 'number', minimum: 5, maximum: 500 },
      },
      required: ['count', 'speed', 'spread'],
      additionalProperties: false,
    },
    defaults: { count: 4000, speed: 24, spread: 120 },
    keywords: ['rain', 'raining', 'rainy', 'downpour', 'drizzle', 'shower', 'storm', 'precipitation'],
    fields: [
      { key: 'particles', role: 'constant', fromParam: 'count' },
      { key: 'fallSpeed', role: 'constant', fromParam: 'speed' },
      { key: 'headY', role: 'animated', witness: [300, 241.5] },
      { key: 'instance', role: 'resource', witness: 'rain-emitter#0' },
    ],
  },
  {
    name: 'snow-emitter',
    summary: 'Slow drifting flakes with lateral noise.',
    statePath: 'weather.snow',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 100, maximum: 12000 },
        drift: { type: 'number', minimum: 0.1, maximum: 12 },
      },
      required: ['count', 'drift'],
      additionalProperties: false,
    },
    defaults: { count: 2500, drift: 1.5 },
    keywords: ['snow', 'snowing', 'snowy', 'blizzard', 'flurries', 'flakes', 'winter'],
    fields: [
      { key: 'particles', role: 'constant', fromParam: 'count' },
      { key: 'driftPhase', role: 'animated', witness: [0, 0.83] },
      { key: 'instance', role: 'resource', witness: 'snow-emitter#0' },
    ],
  },
  {
    name: 'wind-field',
    summary: 'Directional force field that other primitives sample.',
    statePath: 'forces.wind',
    schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'array',
          items: { type: 'number', minimum: -1, maximum: 1 },
          minItems: 3,
          maxItems: 3,
        },
        strength: { type: 'number', minimum: 0, maximum: 40 },
      },
      required: ['direction', 'strength'],
      additionalProperties: false,
    },
    defaults: { direction: [0.7, 0, 0.7], strength: 6 },
    keywords: ['wind', 'windy', 'breeze', 'gust', 'gale', 'blow', 'blowing', 'storm'],
    fields: [
      {
        key: 'direction',
        role: 'vector',
        fromParam: 'direction',
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      },
      { key: 'strength', role: 'constant', fromParam: 'strength' },
      { key: 'gustPhase', role: 'animated', witness: [0, 1.27] },
      { key: 'instance', role: 'resource', witness: 'wind-field#0' },
    ],
  },
  {
    name: 'fog-volume',
    summary: 'Exponential distance fog over the base scene.',
    statePath: 'atmosphere.fog',
    schema: {
      type: 'object',
      properties: {
        density: { type: 'number', minimum: 0.001, maximum: 0.2 },
        color: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 1 },
          minItems: 3,
          maxItems: 3,
        },
      },
      required: ['density', 'color'],
      additionalProperties: false,
    },
    defaults: { density: 0.035, color: [0.62, 0.66, 0.72] },
    keywords: ['fog', 'foggy', 'mist', 'misty', 'haze', 'hazy', 'murk', 'gloom'],
    fields: [
      { key: 'density', role: 'constant', fromParam: 'density' },
      { key: 'color', role: 'vector', fromParam: 'color', bounds: UNIT_RGB },
      { key: 'instance', role: 'resource', witness: 'fog-volume#0' },
    ],
  },
  {
    name: 'ambient-light',
    summary: 'Uniform fill light; the brightness verb.',
    statePath: 'lighting.ambient',
    schema: {
      type: 'object',
      properties: {
        intensity: { type: 'number', minimum: 0.01, maximum: 8 },
        color: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 1 },
          minItems: 3,
          maxItems: 3,
        },
      },
      required: ['intensity', 'color'],
      additionalProperties: false,
    },
    defaults: { intensity: 1.2, color: [1, 1, 1] },
    keywords: ['light', 'lighting', 'brighter', 'brighten', 'darker', 'darken', 'dim', 'bright', 'sunlight'],
    fields: [
      { key: 'intensity', role: 'constant', fromParam: 'intensity' },
      { key: 'color', role: 'vector', fromParam: 'color', bounds: UNIT_RGB },
      { key: 'instance', role: 'resource', witness: 'ambient-light#0' },
    ],
  },
  {
    name: 'orbit-modulator',
    summary: 'Drives an existing object around a circular path.',
    statePath: 'motion.orbit',
    schema: {
      type: 'object',
      properties: {
        speed: { type: 'number', minimum: 0.01, maximum: 20 },
        radius: { type: 'number', minimum: 0.1, maximum: 200 },
        axis: { type: 'string', enum: ['x', 'y', 'z'] },
      },
      required: ['speed', 'radius', 'axis'],
      additionalProperties: false,
    },
    defaults: { speed: 1, radius: 12, axis: 'y' },
    keywords: ['orbit', 'orbiting', 'spin', 'spinning', 'rotate', 'rotating', 'revolve', 'circle', 'swirl'],
    fields: [
      { key: 'speed', role: 'constant', fromParam: 'speed' },
      { key: 'axis', role: 'constant', fromParam: 'axis' },
      { key: 'angle', role: 'animated', witness: [0, 2.09] },
      { key: 'instance', role: 'resource', witness: 'orbit-modulator#0' },
    ],
  },
];

export function findPrimitive(
  catalogue: readonly PrimitiveSpec[],
  name: string,
): PrimitiveSpec | undefined {
  return catalogue.find((p) => p.name === name);
}
