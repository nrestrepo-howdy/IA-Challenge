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
    // Was [0.62, 0.66, 0.72] — a light grey that washed the whole world pale. The
    // value went unnoticed for two days because `fogBinding` read the wrong key and
    // never applied it; fixing the dead binding is what surfaced the bad default.
    // This sits near the scene's authored horizon, so fog thickens the night instead
    // of replacing it.
    defaults: { density: 0.035, color: [0.10, 0.12, 0.17] },
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
    name: 'lightning',
    summary: 'Occasional bright flash with a decaying afterglow.',
    statePath: 'weather.lightning',
    schema: {
      type: 'object',
      properties: {
        intensity: { type: 'number', minimum: 0.1, maximum: 20 },
        decay: { type: 'number', minimum: 0.2, maximum: 12 },
        frequency: { type: 'number', minimum: 0.02, maximum: 4 },
      },
      required: ['intensity', 'decay', 'frequency'],
      additionalProperties: false,
    },
    defaults: { intensity: 6, decay: 3.5, frequency: 0.35 },
    keywords: ['lightning', 'thunder', 'thunderstorm', 'thunderbolt', 'bolt', 'flash', 'flashes', 'flashing', 'strike', 'strikes'],
    fields: [
      { key: 'peak', role: 'constant', fromParam: 'intensity' },
      { key: 'decay', role: 'constant', fromParam: 'decay' },
      // The flash itself is episodic, so it cannot be the animated witness: a window
      // that happens to fall between two strikes would read identical glow at both
      // ends and reject a primitive that is behaving exactly as asked. `phase` is the
      // strictly-increasing storm clock the strikes are scheduled against, so it moves
      // on every step for every frequency the schema admits.
      { key: 'phase', role: 'animated', witness: [0, 0.18] },
      { key: 'instance', role: 'resource', witness: 'lightning#0' },
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

  // ─── structural primitives ─────────────────────────────────────────────────
  // Everything above changes the weather. These three change the world itself: they
  // raise geometry, rescale the authored city, and restate what the ground is made
  // of. They are declared exactly like the atmospheric entries — the role tags are
  // what make their contracts derivable (§4.4), and the closed set is what keeps the
  // model composing rather than inventing (D-2).
  {
    name: 'tower',
    summary: 'Raises a distinctive structure out of the ground.',
    statePath: 'structures.tower',
    schema: {
      type: 'object',
      properties: {
        height: { type: 'number', minimum: 20, maximum: 600 },
        girth: { type: 'number', minimum: 4, maximum: 120 },
        count: { type: 'integer', minimum: 1, maximum: 8 },
        placement: { type: 'string', enum: ['center', 'ring', 'avenue'] },
      },
      required: ['height', 'girth', 'count', 'placement'],
      additionalProperties: false,
    },
    // Raised from 260x28x1 after L3 measured the default at 0.194% of pixels changed
    // -- below its own visibility floor. The perceptual layer was right: a single
    // slender tower at the far end of a 260-building skyline is not something a person
    // would notice happened. A verb whose result nobody can see has not run.
    // Two corrections, in opposite directions. L3 measured the original 260x28x1 at
    // 0.194% of pixels changed — invisible. Raising it to 420x46x3 at `center` then put
    // three slabs on the origin the camera orbits, so they filled the frame from the
    // inside. The camera path is the constraint nobody wrote down: `ring` places them
    // where they read as landmarks rather than as walls.
    defaults: { height: 460, girth: 34, count: 3, placement: 'ring' },
    keywords: [
      'tower', 'towers', 'skyscraper', 'spire', 'monolith', 'obelisk', 'monument',
      'landmark', 'pillar', 'build', 'raise',
    ],
    fields: [
      { key: 'height', role: 'constant', fromParam: 'height' },
      { key: 'girth', role: 'constant', fromParam: 'girth' },
      { key: 'towers', role: 'constant', fromParam: 'count' },
      { key: 'placement', role: 'constant', fromParam: 'placement' },
      // `growth` is the visible quantity and it is the wrong witness, for the same
      // reason lightning's `glow` was: it eases to 1 and then stops moving, so a
      // window taken after the rise finished reads identical at both ends and rejects
      // a tower standing exactly where it was asked to stand. `risePhase` is the
      // monotonic clock the growth is a function of, so it advances on every step for
      // every parameter the schema admits.
      { key: 'risePhase', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'tower#0' },
    ],
  },
  {
    name: 'skyline-shift',
    summary: 'Rescales the authored city: taller, denser or sparser.',
    statePath: 'structures.skyline',
    schema: {
      type: 'object',
      properties: {
        heightScale: { type: 'number', minimum: 0.25, maximum: 5 },
        density: { type: 'number', minimum: 0.1, maximum: 2 },
      },
      required: ['heightScale', 'density'],
      additionalProperties: false,
    },
    // Tuned down from 2x/1.35 after looking at the result: at the default the camera
    // ends up inside the city with the moon occluded, and the moon is the frame's
    // light anchor. A verb that improves the world by removing its composition is
    // doing what was asked and not what was wanted. The full range stays reachable
    // when a request actually asks for it.
    defaults: { heightScale: 1.45, density: 1.15 },
    keywords: [
      'skyline', 'city', 'cityscape', 'buildings', 'metropolis', 'downtown', 'urban',
      'taller', 'denser', 'sparser', 'district', 'blocks',
    ],
    fields: [
      { key: 'heightScale', role: 'constant', fromParam: 'heightScale' },
      { key: 'density', role: 'constant', fromParam: 'density' },
      // Same trap, same answer: `blend` saturates at 1 once the city has finished
      // moving; `shiftPhase` never stops.
      { key: 'shiftPhase', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'skyline-shift#0' },
    ],
  },
  {
    name: 'ground-tint',
    summary: 'Restates what the ground is made of: its colour and roughness.',
    statePath: 'surface.ground',
    schema: {
      type: 'object',
      properties: {
        color: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 1 },
          minItems: 3,
          maxItems: 3,
        },
        roughness: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['color', 'roughness'],
      additionalProperties: false,
    },
    // Sand rather than the base scene's wet asphalt: a default that resembles what is
    // already on screen makes the verb read as a no-op even when it worked.
    defaults: { color: [0.46, 0.36, 0.24], roughness: 0.92 },
    keywords: [
      'ground', 'floor', 'terrain', 'desert', 'sand', 'sandy', 'dunes', 'obsidian',
      'asphalt', 'concrete', 'grass', 'soil', 'dirt', 'rock',
    ],
    fields: [
      { key: 'color', role: 'vector', fromParam: 'color', bounds: UNIT_RGB },
      { key: 'roughness', role: 'constant', fromParam: 'roughness' },
      { key: 'tintPhase', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'ground-tint#0' },
    ],
  },
];

export function findPrimitive(
  catalogue: readonly PrimitiveSpec[],
  name: string,
): PrimitiveSpec | undefined {
  return catalogue.find((p) => p.name === name);
}
