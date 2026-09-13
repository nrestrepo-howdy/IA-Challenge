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
  /**
   * Words that pin a parameter to a value, for the offline resolver.
   *
   * Without this, the keyword resolver only ever selects a primitive and leaves every
   * parameter at its default — so "make it night", "sunset" and "dawn" all resolved to
   * noon, because noon is `daylight`'s default. The primitive ran, the contract passed,
   * and the user got the opposite of what they asked for: a success reported for the
   * wrong thing, which is the failure mode this project exists to refuse.
   *
   * A ranking signal, not a parser. The hosted resolver still does the real work.
   */
  readonly paramHints?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
    keywords: ['rain', 'raining', 'rainy', 'downpour', 'drizzle', 'shower', 'storm', 'stormy', 'precipitation'],
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
    // 2500 flakes over a 1100-unit field is a flurry nobody notices. Snow reads by
    // density, not by flake size — the count is what makes it weather.
    defaults: { count: 8000, drift: 2.2 },
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
    keywords: ['wind', 'windy', 'breeze', 'gust', 'gale', 'blow', 'blowing', 'storm', 'stormy'],
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
    // 'storm' and 'stormy' belong here as much as on rain and wind. A storm the
      // keyword path answered with rain and wind but no lightning was a storm missing
      // the half that makes it one — and because 'stormy' matched nothing at all, the
      // resolver then disclosed the word, reporting failure for the request it had
      // just half-answered.
      keywords: ['lightning', 'thunder', 'thunderstorm', 'thunderbolt', 'bolt', 'flash', 'flashes', 'flashing', 'strike', 'strikes', 'storm', 'stormy'],
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
    defaults: { height: 420, girth: 46, count: 3, placement: 'center' },
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

  // ─── the two verbs a first-time user actually types ────────────────────────
  // The world is authored at night with no water in it, so "make it day" and "add
  // water" were the two most obvious requests in the product and neither resolved to
  // anything. Both are declared exactly like every entry above — the role tags are
  // what make their contracts derivable (§4.4), not a special case.
  {
    name: 'daylight',
    summary: 'Sets the time of day: sky, sun or moon, stars, key light and fog.',
    statePath: 'atmosphere.daylight',
    schema: {
      type: 'object',
      properties: {
        // One turn of the clock. 0 and 1 are the same midnight, which is what makes a
        // sweep across the wrap point expressible rather than a special case.
        phase: { type: 'number', minimum: 0, maximum: 1 },
        // Up to three seconds, not sixty. The wide range was the catalogue describing
        // what a crossfade *could* be; the product is "say it and watch", and a model
        // reading "up to 60" quite reasonably picked 48 for a slow dawn — after which
        // the world sat visibly unchanged for most of a minute and L3, judging the
        // frame right after the mount, reported a starry night for "amanece sobre el
        // mar". Both complaints are the same number being too large.
        transition: { type: 'number', minimum: 0.25, maximum: 3 },
      },
      required: ['phase', 'transition'],
      additionalProperties: false,
    },
    // Noon, because the offline keyword resolver leaves every parameter at its default
    // and "make it day" is the utterance this entry exists to answer. A default of
    // midnight would resolve the single most common request to a no-op against a world
    // that is already night. Dawn, dusk and night stay reachable — the hosted resolver
    // reads the schema and moves `phase`; the keyword path cannot, and says so by
    // giving the request that matters the answer it wants.
    defaults: { phase: 0.5, transition: 2.5 },
    keywords: [
      'day', 'daytime', 'daylight', 'daybreak', 'morning', 'noon', 'midday',
      'afternoon', 'sun', 'sunny', 'sunrise', 'sunset', 'dawn', 'dusk', 'twilight',
      'evening', 'night', 'nighttime', 'midnight', 'sky', 'time',
    ],
    paramHints: {
      night: { phase: 0 }, midnight: { phase: 0 }, dark: { phase: 0 },
      dawn: { phase: 0.25 }, sunrise: { phase: 0.25 }, morning: { phase: 0.3 },
      day: { phase: 0.5 }, noon: { phase: 0.5 }, midday: { phase: 0.5 },
      afternoon: { phase: 0.62 },
      dusk: { phase: 0.75 }, sunset: { phase: 0.75 }, evening: { phase: 0.78 },
      twilight: { phase: 0.8 },
    },
    fields: [
      { key: 'phase', role: 'constant', fromParam: 'phase' },
      { key: 'transition', role: 'constant', fromParam: 'transition' },
      // `phaseNow` and `mix` are the visible quantities and both are the wrong
      // witness: they arrive at the requested time and then correctly stop moving, so
      // a window taken after the sweep finished reads identical at both ends and
      // rejects a sky sitting exactly where it was asked to sit. `dayClock` is the
      // monotonic clock the sweep is a function of.
      { key: 'dayClock', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'daylight#0' },
    ],
  },
  {
    name: 'water',
    summary: 'A reflective, moving water surface at a settable level.',
    statePath: 'surface.water',
    schema: {
      type: 'object',
      properties: {
        // Below zero the water hides under the authored ground; above the skyline's
        // shorter buildings it drowns them. Both are legitimate answers to a request.
        level: { type: 'number', minimum: -40, maximum: 260 },
        choppiness: { type: 'number', minimum: 0.05, maximum: 5 },
      },
      required: ['level', 'choppiness'],
      additionalProperties: false,
    },
    // Just above the authored ground plane, so the city stands in the water rather
    // than beside it and the moon has something to sit on.
    defaults: { level: 2.5, choppiness: 1 },
    keywords: [
      'water', 'ocean', 'sea', 'lake', 'river', 'flood', 'flooded', 'waves', 'wave',
      'tide', 'harbour', 'harbor', 'bay', 'lagoon', 'canal', 'waterfront', 'submerge',
      'reflection', 'reflections',
    ],
    fields: [
      { key: 'level', role: 'constant', fromParam: 'level' },
      { key: 'choppiness', role: 'constant', fromParam: 'choppiness' },
      // Same trap, same answer: `levelNow` reaches the waterline and stops; the swell
      // clock never does, and it advances for every choppiness the schema admits.
      { key: 'wavePhase', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'water#0' },
    ],
  },

  // ─── the world stops being still ──────────────────────────────────────────
  // Twelve entries covered weather, light, time of day, water and city structure, and
  // between them they could not make the world do anything *alive or spectacular*: a
  // user who had tried rain, day and towers had run out of things to be surprised by.
  // These three are the answer, and they are declared exactly like every entry above —
  // the role tags are what make their contracts derivable (§4.4), and each one's
  // animated witness is a monotonic clock rather than the value its binding draws.
  {
    name: 'aurora',
    summary: 'Ribbons of light drifting across the upper sky.',
    statePath: 'atmosphere.aurora',
    schema: {
      type: 'object',
      properties: {
        intensity: { type: 'number', minimum: 0.1, maximum: 4 },
        bands: { type: 'integer', minimum: 1, maximum: 6 },
        // One turn of the colour wheel: 0.42 is the green of a real aurora, and the
        // rest of the wheel is what makes "a violet aurora" expressible rather than a
        // request the catalogue has to refuse.
        hue: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['intensity', 'bands', 'hue'],
      additionalProperties: false,
    },
    // Bright and multi-banded, because the offline keyword resolver leaves every
    // parameter at its default and a timid default would answer the request with
    // something the user has to be told is there.
    defaults: { intensity: 1.9, bands: 4, hue: 0.42 },
    keywords: [
      'aurora', 'auroras', 'borealis', 'australis', 'northern', 'polar', 'ribbons',
      'curtains', 'shimmer', 'skyglow',
    ],
    paramHints: {
      faint: { intensity: 0.6 }, subtle: { intensity: 0.6 }, dim: { intensity: 0.6 },
      blazing: { intensity: 3.6 }, vivid: { intensity: 3.6 }, intense: { intensity: 3.6 },
      green: { hue: 0.42 }, emerald: { hue: 0.42 }, teal: { hue: 0.5 },
      blue: { hue: 0.58 }, violet: { hue: 0.76 }, purple: { hue: 0.76 },
      magenta: { hue: 0.88 }, pink: { hue: 0.9 }, crimson: { hue: 0.99 }, red: { hue: 0.99 },
      single: { bands: 1 }, lone: { bands: 1 }, many: { bands: 6 },
    },
    fields: [
      { key: 'intensity', role: 'constant', fromParam: 'intensity' },
      { key: 'bands', role: 'constant', fromParam: 'bands' },
      { key: 'hue', role: 'constant', fromParam: 'hue' },
      // `glow` is the visible quantity and it is the wrong witness for the reason
      // `daylight` and `tower` both give: it fades in, arrives, and then correctly
      // stops — and it is additionally zero all day, so a contract over it would fail
      // an aurora that is behaving exactly as asked. `curtainPhase` is the monotonic
      // drift clock the ribbons are a function of.
      { key: 'curtainPhase', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'aurora#0' },
    ],
  },
  {
    name: 'flock',
    summary: 'A flock of birds crossing the city, continuously in motion.',
    statePath: 'life.flock',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 6, maximum: 400 },
        // The minimum is 1, not 0: a flock that can be asked to stand still is a
        // primitive whose `animated` field is provably inert for a legal parameter.
        speed: { type: 'number', minimum: 1, maximum: 60 },
        altitude: { type: 'number', minimum: 10, maximum: 400 },
      },
      required: ['count', 'speed', 'altitude'],
      additionalProperties: false,
    },
    defaults: { count: 140, speed: 22, altitude: 120 },
    keywords: [
      'flock', 'flocks', 'birds', 'bird', 'swarm', 'starlings', 'murmuration',
      'gulls', 'seagulls', 'bats', 'fireflies', 'drones', 'wildlife', 'migration',
    ],
    paramHints: {
      murmuration: { count: 380, speed: 30 }, swarm: { count: 380 },
      fireflies: { count: 380, speed: 4, altitude: 22 },
      drones: { count: 40, speed: 16, altitude: 170 },
      bats: { count: 260, speed: 26, altitude: 60 },
      few: { count: 14 }, single: { count: 6 }, lone: { count: 6 },
      fast: { speed: 46 }, slow: { speed: 6 },
      high: { altitude: 340 }, low: { altitude: 30 },
    },
    fields: [
      { key: 'birds', role: 'constant', fromParam: 'count' },
      { key: 'speed', role: 'constant', fromParam: 'speed' },
      { key: 'altitude', role: 'constant', fromParam: 'altitude' },
      // Distance flown. Nothing here saturates, but the witness is still the clock
      // rather than the position: `centroid` comes back around the circuit, and a
      // wrapping value asserted with `changesOverTime` is a stopwatch (`lightning.ts`).
      { key: 'flightPhase', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'flock#0' },
    ],
  },
  {
    name: 'searchlights',
    summary: 'Beams sweeping up out of the city into the sky.',
    statePath: 'lighting.searchlights',
    schema: {
      type: 'object',
      properties: {
        beams: { type: 'integer', minimum: 1, maximum: 8 },
        // Minimum 0.05 rather than 0, for the same reason `flock` has no zero speed.
        speed: { type: 'number', minimum: 0.05, maximum: 4 },
        // Beam half-angle, in degrees.
        spread: { type: 'number', minimum: 1, maximum: 20 },
      },
      required: ['beams', 'speed', 'spread'],
      additionalProperties: false,
    },
    defaults: { beams: 5, speed: 0.55, spread: 4.5 },
    keywords: [
      'searchlights', 'searchlight', 'spotlight', 'spotlights', 'floodlights',
      'beams', 'beam', 'klieg', 'premiere', 'sweeping',
    ],
    paramHints: {
      premiere: { beams: 8, speed: 0.9 }, klieg: { beams: 8 },
      single: { beams: 1 }, lone: { beams: 1 },
      frantic: { speed: 2.8 }, fast: { speed: 2.8 }, slow: { speed: 0.15 },
      wide: { spread: 13 }, narrow: { spread: 1.6 },
    },
    fields: [
      { key: 'beams', role: 'constant', fromParam: 'beams' },
      { key: 'speed', role: 'constant', fromParam: 'speed' },
      { key: 'spread', role: 'constant', fromParam: 'spread' },
      // The wrapped angles the cones are pointed along live in `aim`; the witness is
      // the clock they are derived from, which never comes back around.
      { key: 'sweepPhase', role: 'animated', witness: [0, 0.5] },
      { key: 'instance', role: 'resource', witness: 'searchlights#0' },
    ],
  },
];

export function findPrimitive(
  catalogue: readonly PrimitiveSpec[],
  name: string,
): PrimitiveSpec | undefined {
  return catalogue.find((p) => p.name === name);
}
