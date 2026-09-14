/**
 * Rigs the world can be asked for, and the code that moves them.
 *
 * This is the floor for the freeform path, and it is the same shape the model's output
 * has to take: a name, a place to stand, a list of typed parts, and `pose` as *source
 * text*. Keeping the offline entries in exactly the form the model must produce is what
 * stops the two paths drifting — the compiler, the emitter, L0 and the contract all see
 * one kind of figure, and the only difference is who wrote the string.
 *
 * The scale deserves saying out loud. A person is about 1.8 metres and a tower here is
 * three hundred units, so a figure at true scale is smaller than one pixel from a
 * camera that frames a skyline. These stand around twenty units and walk the near
 * plaza: not a realistic human among realistic buildings, but a figure you can actually
 * see in a frame composed for a city. Choosing the readable scale over the correct one
 * is a decision, and it is this one.
 */

import type { Shape } from '../world/figure.js';

export interface FigurePart {
  readonly id: string;
  readonly shape: Shape;
  readonly size: readonly [number, number, number];
  readonly color: readonly [number, number, number];
  readonly emissive?: number;
}

export interface FigureSpec {
  /** Lowercase and dashed: it becomes the state path, `figures.<name>`. */
  readonly name: string;
  readonly origin: readonly [number, number, number];
  readonly parts: readonly FigurePart[];
  /**
   * The body of `(t, p) => { ... }`, as text.
   *
   * `t` is elapsed seconds and `p` is one target per part in declaration order, each
   * reset to rest before the call. Everything it writes is clamped on the way into
   * state, so the worst a bad pose can do is stand still in the wrong place.
   */
  readonly pose: string;
  /** Shown in the log, in the language the request was written in where possible. */
  readonly rationale: string;
  /** Substrings that select it. Matched after the Spanish lexicon has run. */
  readonly triggers: readonly string[];
  /**
   * Words this rig answers for, beyond the ones that selected it.
   *
   * Separate from `triggers` because selecting and accounting are different jobs. The
   * pair is chosen by "walking the dog"; it also puts a person on screen, so it has to
   * claim "person" when the resolver lists it as beyond the catalogue — otherwise the
   * log tells the user the figure walking across the frame is not there. Adding those
   * words to `triggers` instead would make "a person" resolve to a person *and a dog*.
   */
  readonly covers?: readonly string[];
}

const FUR: readonly [number, number, number] = [0.38, 0.26, 0.16];
const COAT: readonly [number, number, number] = [0.16, 0.19, 0.28];
const SKIN: readonly [number, number, number] = [0.72, 0.56, 0.44];

/**
 * A walking person, at eight heads.
 *
 * The proportions were guessed and they read as a blob: the head was a quarter of the
 * figure, the torso was nearly as wide as it was tall, and the arms sat *inside* the
 * torso's own half-width, so a walk cycle swung limbs that were buried in a capsule.
 * Every one of those is visible in a screenshot and none of them is visible in the
 * numbers unless you know what to compare them against.
 *
 * So they come from the canon instead. The eight-head figure is the standard artists
 * have used since Vitruvius: total height is eight head-lengths, the shoulders are two,
 * the hips fall at the halfway line, and the fingertips reach mid-thigh. At a total of
 * 40 units the head is 5, which is what makes everything else fall out.
 *
 * The limbs are split at the joint. An arm as one capsule cannot bend, so a walk can
 * only slide it back and forth; an upper arm and a forearm with an elbow between them
 * is the difference between a figure that is walking and a figure being carried.
 */
const HEAD = 5;                   // one head-length; the figure is eight of them
const PERSON_PARTS: readonly FigurePart[] = [
  // Hips to shoulders. Shoulders are two head-lengths across, so half-width is one.
  { id: 'torso', shape: 'capsule', size: [HEAD * 0.98, HEAD * 1.35, HEAD * 0.5], color: COAT, emissive: 0.16 },
  { id: 'hips', shape: 'capsule', size: [HEAD * 0.72, HEAD * 0.42, HEAD * 0.46], color: [0.12, 0.13, 0.18], emissive: 0.12 },
  { id: 'head', shape: 'sphere', size: [HEAD * 0.4, HEAD * 0.5, HEAD * 0.42], color: SKIN, emissive: 0.2 },
  { id: 'neck', shape: 'cylinder', size: [HEAD * 0.16, HEAD * 0.16, HEAD * 0.16], color: SKIN, emissive: 0.16 },
  // Arms outboard of the shoulder, not inside it: x sits beyond the torso's half-width.
  { id: 'arm-l', shape: 'capsule', size: [HEAD * 0.16, HEAD * 0.62, HEAD * 0.16], color: COAT, emissive: 0.16 },
  { id: 'arm-r', shape: 'capsule', size: [HEAD * 0.16, HEAD * 0.62, HEAD * 0.16], color: COAT, emissive: 0.16 },
  { id: 'forearm-l', shape: 'capsule', size: [HEAD * 0.14, HEAD * 0.58, HEAD * 0.14], color: SKIN, emissive: 0.16 },
  { id: 'forearm-r', shape: 'capsule', size: [HEAD * 0.14, HEAD * 0.58, HEAD * 0.14], color: SKIN, emissive: 0.16 },
  { id: 'thigh-l', shape: 'capsule', size: [HEAD * 0.22, HEAD * 0.92, HEAD * 0.22], color: [0.12, 0.13, 0.18], emissive: 0.12 },
  { id: 'thigh-r', shape: 'capsule', size: [HEAD * 0.22, HEAD * 0.92, HEAD * 0.22], color: [0.12, 0.13, 0.18], emissive: 0.12 },
  { id: 'shin-l', shape: 'capsule', size: [HEAD * 0.18, HEAD * 0.88, HEAD * 0.18], color: [0.1, 0.11, 0.15], emissive: 0.12 },
  { id: 'shin-r', shape: 'capsule', size: [HEAD * 0.18, HEAD * 0.88, HEAD * 0.18], color: [0.1, 0.11, 0.15], emissive: 0.12 },
];

/**
 * A dog, at a scale a dog actually is: about sixteen units at the shoulder, which is
 * two-fifths of the person beside it. The first one was a tenth of the person and read
 * as a rat on a lead.
 */
const DOG_PARTS: readonly FigurePart[] = [
  { id: 'body', shape: 'capsule', size: [2.1, 5.0, 2.4], color: FUR, emissive: 0.24 },
  { id: 'chest', shape: 'capsule', size: [2.4, 2.2, 2.6], color: FUR, emissive: 0.24 },
  { id: 'neck', shape: 'cylinder', size: [1.1, 1.6, 1.1], color: FUR, emissive: 0.24 },
  { id: 'head', shape: 'box', size: [1.5, 1.4, 1.7], color: FUR, emissive: 0.26 },
  { id: 'muzzle', shape: 'box', size: [0.75, 0.62, 1.25], color: [0.26, 0.18, 0.11], emissive: 0.3 },
  { id: 'ear-l', shape: 'wedge', size: [0.3, 0.9, 0.7], color: [0.26, 0.18, 0.11], emissive: 0.24 },
  { id: 'ear-r', shape: 'wedge', size: [0.3, 0.9, 0.7], color: [0.26, 0.18, 0.11], emissive: 0.24 },
  { id: 'leg-fl', shape: 'cylinder', size: [0.5, 3.1, 0.5], color: FUR, emissive: 0.22 },
  { id: 'leg-fr', shape: 'cylinder', size: [0.5, 3.1, 0.5], color: FUR, emissive: 0.22 },
  { id: 'leg-bl', shape: 'cylinder', size: [0.55, 3.1, 0.55], color: FUR, emissive: 0.22 },
  { id: 'leg-br', shape: 'cylinder', size: [0.55, 3.1, 0.55], color: FUR, emissive: 0.22 },
  { id: 'tail', shape: 'capsule', size: [0.38, 1.7, 0.38], color: FUR, emissive: 0.24 },
];

/**
 * The gait, written once for the new anatomy.
 *
 * `leg` walks the promenade up and back; `w` is the phase of the stride. Limbs are
 * placed at joints rather than at fixed offsets, so the elbow and the knee land where
 * the segment above them ends — which is the whole reason the arms were split in two.
 */
const WALK_PREAMBLE = `
  const speed = 4.6;
  const leg = ((t * speed) % 150) - 75;
  const out = leg > 0;
  const path = out ? 75 - leg * 2 : 75 + leg * 2;
  const facing = out ? Math.PI : 0;
  const w = t * 3.1;
  const swing = Math.sin(w);
  const bob = Math.abs(Math.sin(w)) * 0.9;
`;

/**
 * Eight heads, laid out from the ground up: shins 0-8.8, thighs to 18, hips at 19.5,
 * torso 20-33.5, neck, head centred at 36.5. The arms hang outboard of the shoulder at
 * x = 5.6 against a torso half-width of 4.9, which is the difference between an arm and
 * a bulge in a capsule.
 */
const PERSON_POSE = `
  const px = 8, sh = 32;
  const kneeL = -swing * 3.4, kneeR = swing * 3.4;
  p[0].x = px; p[0].y = 26.8 + bob; p[0].z = path; p[0].yaw = facing;
  p[1].x = px; p[1].y = 19.6 + bob; p[1].z = path; p[1].yaw = facing;
  p[2].x = px; p[2].y = 36.6 + bob; p[2].z = path + Math.sin(w * 2) * 0.2;
  p[3].x = px; p[3].y = 34.2 + bob; p[3].z = path;
  // Arms counter-swing against the legs, which is most of what makes a walk read.
  p[4].x = px + 5.6; p[4].y = 28.9 + bob; p[4].z = path + swing * 1.6; p[4].pitch = swing * 0.5;
  p[5].x = px - 5.6; p[5].y = 28.9 + bob; p[5].z = path - swing * 1.6; p[5].pitch = -swing * 0.5;
  p[6].x = px + 5.6; p[6].y = 23.1 + bob; p[6].z = path + swing * 3.0; p[6].pitch = swing * 0.72;
  p[7].x = px - 5.6; p[7].y = 23.1 + bob; p[7].z = path - swing * 3.0; p[7].pitch = -swing * 0.72;
  p[8].x = px + 2.4; p[8].y = 13.4; p[8].z = path - swing * 2.6; p[8].pitch = -swing * 0.46;
  p[9].x = px - 2.4; p[9].y = 13.4; p[9].z = path + swing * 2.6; p[9].pitch = swing * 0.46;
  p[10].x = px + 2.4; p[10].y = 4.4; p[10].z = path - swing * 4.6 + kneeL * 0.3; p[10].pitch = -swing * 0.2;
  p[11].x = px - 2.4; p[11].y = 4.4; p[11].z = path + swing * 4.6 + kneeR * 0.3; p[11].pitch = swing * 0.2;
`;

/**
 * The dog, trotting on diagonal pairs — front-left with back-right, which is what a dog
 * actually does and what stops four legs moving like a pantomime horse.
 */
const DOG_POSE = `
  const trot = w * 1.7;
  const lift = Math.abs(Math.sin(trot)) * 0.5;
  const dx = -6, dz = -9;
  p[0].x = dx; p[0].y = 8.6 + lift; p[0].z = path + dz; p[0].pitch = Math.PI / 2; p[0].yaw = facing;
  p[1].x = dx; p[1].y = 9.0 + lift; p[1].z = path + dz + 4.6; p[1].pitch = Math.PI / 2;
  p[2].x = dx; p[2].y = 11.2 + lift; p[2].z = path + dz + 6.4; p[2].pitch = 0.7;
  p[3].x = dx; p[3].y = 13.0 + lift; p[3].z = path + dz + 7.6;
  p[4].x = dx; p[4].y = 12.3 + lift; p[4].z = path + dz + 9.2;
  p[5].x = dx + 1.1; p[5].y = 14.4 + lift; p[5].z = path + dz + 7.3;
  p[6].x = dx - 1.1; p[6].y = 14.4 + lift; p[6].z = path + dz + 7.3;
  p[7].x = dx + 1.5; p[7].y = 3.1; p[7].z = path + dz + 4.2; p[7].pitch = Math.sin(trot) * 0.7;
  p[8].x = dx - 1.5; p[8].y = 3.1; p[8].z = path + dz + 4.2; p[8].pitch = -Math.sin(trot) * 0.7;
  p[9].x = dx + 1.6; p[9].y = 3.1; p[9].z = path + dz - 3.4; p[9].pitch = -Math.sin(trot) * 0.7;
  p[10].x = dx - 1.6; p[10].y = 3.1; p[10].z = path + dz - 3.4; p[10].pitch = Math.sin(trot) * 0.7;
  p[11].x = dx; p[11].y = 10.4 + lift; p[11].z = path + dz - 5.4; p[11].pitch = 0.9 + Math.sin(w * 5) * 0.45;
`;

/**
 * Namespaces a rig's part ids so two rigs can share one figure.
 *
 * The pair is a person and a dog, and both of them have a head. `figure.mount` rejects
 * duplicate ids — which it did, on the first run, and L1 reported
 * `duplicate part id 'head'` against all three candidates before anything reached the
 * world. The validator caught its own author, which is the only kind of evidence worth
 * having that it works.
 */
function prefixed(parts: readonly FigurePart[], prefix: string): readonly FigurePart[] {
  return parts.map((part) => ({ ...part, id: `${prefix}-${part.id}` }));
}

const STEEL: readonly [number, number, number] = [0.34, 0.09, 0.08];
const GLASS: readonly [number, number, number] = [0.08, 0.1, 0.14];
const BARK: readonly [number, number, number] = [0.22, 0.16, 0.1];
const LEAF: readonly [number, number, number] = [0.1, 0.2, 0.11];

/** A car: body, cabin, four wheels, two headlights and two tail lights. */
const CAR_PARTS: readonly FigurePart[] = [
  { id: 'body', shape: 'box', size: [12.6, 2.2, 5.2], color: STEEL, emissive: 0.12 },
  { id: 'cabin', shape: 'box', size: [5.2, 1.9, 4.6], color: GLASS, emissive: 0.18 },
  { id: 'wheel-fl', shape: 'cylinder', size: [1.5, 0.7, 1.5], color: [0.06, 0.06, 0.07] },
  { id: 'wheel-fr', shape: 'cylinder', size: [1.5, 0.7, 1.5], color: [0.06, 0.06, 0.07] },
  { id: 'wheel-bl', shape: 'cylinder', size: [1.5, 0.7, 1.5], color: [0.06, 0.06, 0.07] },
  { id: 'wheel-br', shape: 'cylinder', size: [1.5, 0.7, 1.5], color: [0.06, 0.06, 0.07] },
  // The lamps are the whole reason a car reads at night. They are the brightest thing
  // in the rig by a wide margin and they carry the direction of travel on their own.
  { id: 'lamp-l', shape: 'sphere', size: [0.9, 0.9, 0.9], color: [1, 0.94, 0.78], emissive: 1 },
  { id: 'lamp-r', shape: 'sphere', size: [0.9, 0.9, 0.9], color: [1, 0.94, 0.78], emissive: 1 },
  { id: 'tail-l', shape: 'sphere', size: [0.6, 0.6, 0.6], color: [1, 0.12, 0.08], emissive: 0.9 },
  { id: 'tail-r', shape: 'sphere', size: [0.6, 0.6, 0.6], color: [1, 0.12, 0.08], emissive: 0.9 },
];

/**
 * The drive: down the promenade and back, with the rig turning at each end.
 *
 * `facing` is a yaw of 0 or pi rather than a smooth turn, because a car that pivots
 * over two seconds at this distance reads as a glitch, and one that cuts reads as a cut.
 */
const CAR_POSE = `
  const speed = 21;
  // A 90-unit lap, so the drive stays inside the plaza. The first version swung 150
  // units either way from an origin already 65 out, which drove the car into the
  // building ring at radius 150 — and the camera, which follows the rig, went with it.
  const leg = ((t * speed) % 90) - 45;
  const out = leg > 0;
  const path = out ? 45 - leg * 2 : 45 + leg * 2;
  const facing = out ? Math.PI : 0;
  const dir = out ? -1 : 1;
  const roll = t * 9;
  p[0].y = 3.1; p[0].z = path; p[0].yaw = facing;
  p[1].y = 5.9; p[1].z = path - dir * 1.2; p[1].yaw = facing;
  p[2].y = 1.5; p[2].z = path + dir * 4.2; p[2].x = 2.6; p[2].roll = Math.PI / 2; p[2].pitch = roll;
  p[3].y = 1.5; p[3].z = path + dir * 4.2; p[3].x = -2.6; p[3].roll = Math.PI / 2; p[3].pitch = roll;
  p[4].y = 1.5; p[4].z = path - dir * 4.2; p[4].x = 2.6; p[4].roll = Math.PI / 2; p[4].pitch = roll;
  p[5].y = 1.5; p[5].z = path - dir * 4.2; p[5].x = -2.6; p[5].roll = Math.PI / 2; p[5].pitch = roll;
  p[6].y = 3.2; p[6].z = path + dir * 6.4; p[6].x = 1.9;
  p[7].y = 3.2; p[7].z = path + dir * 6.4; p[7].x = -1.9;
  p[8].y = 3.3; p[8].z = path - dir * 6.4; p[8].x = 1.9;
  p[9].y = 3.3; p[9].z = path - dir * 6.4; p[9].x = -1.9;
`;

/** A tree: trunk and three staggered canopies, breathing in the wind. */
const TREE_PARTS: readonly FigurePart[] = [
  { id: 'trunk', shape: 'cylinder', size: [1.1, 9, 1.1], color: BARK },
  { id: 'canopy-low', shape: 'sphere', size: [7.4, 7.4, 7.4], color: LEAF, emissive: 0.1 },
  { id: 'canopy-mid', shape: 'sphere', size: [6.2, 6.2, 6.2], color: LEAF, emissive: 0.1 },
  { id: 'canopy-top', shape: 'sphere', size: [4.6, 4.6, 4.6], color: LEAF, emissive: 0.12 },
];

/**
 * A tree does not travel, so the motion has to be somewhere else or the contract's
 * `changesOverTime` assertion rejects it — correctly. It sways.
 */
const TREE_POSE = `
  const sway = Math.sin(t * 0.9) * 0.055 + Math.sin(t * 2.3) * 0.018;
  p[0].y = 9; p[0].roll = sway * 0.4;
  p[1].y = 15.5; p[1].x = sway * 9; p[1].z = Math.sin(t * 1.1) * 1.4;
  p[2].y = 21.5; p[2].x = sway * 15; p[2].z = Math.sin(t * 1.1 + 0.4) * 2.1;
  p[3].y = 26.5; p[3].x = sway * 21; p[3].z = Math.sin(t * 1.1 + 0.8) * 2.6;
`;

export const FIGURES: readonly FigureSpec[] = [
  {
    name: 'dog-walker',
    // Left of the frame's centre, 160 units out, and this is projected rather than
    // guessed — three attempts at guessing cost an hour.
    //
    // The camera stands at radius 165, height 25, and looks at a point on a radius of
    // 70 offset 0.42 radians round; the prompt and the log sit in the middle-bottom of
    // what it sees. Anything standing on the ground is below the horizon and therefore
    // low in frame, so the way past the interface is sideways, not further: this is 150
    // units along the view axis and 110 to one side of it, which lands the rig clear of
    // the text and inside the building ring where nothing occludes it. Which side took
    // a screenshot to settle: the first sign put it under the verification panel, and
    // three.js is right-handed with -Z forward, which is the kind of thing that is
    // faster to look at than to reason about.
    //
    // It drifts as the camera orbits, which is correct. A figure pinned to the frame
    // would be a sprite; this one is standing somewhere.
    origin: [-65, 0, 2],
    parts: [...prefixed(PERSON_PARTS, 'walker'), ...prefixed(DOG_PARTS, 'dog')],
    pose: `${WALK_PREAMBLE}${PERSON_POSE}${DOG_POSE.replace(/p\[(\d)\]/g, (_, d) => `p[${Number(d) + 6}]`)}`,
    rationale: 'una persona paseando a un perro por la explanada, al paso',
    triggers: ['dog walk', 'walking the dog', 'walk the dog', 'person walking a dog', 'dog and a person', 'person and a dog', 'dog with a person', 'perro pase', 'pasear', 'paseando'],
    covers: ['dog', 'person', 'walking', 'walk', 'perro', 'persona', 'gente', 'someone'],
  },
  {
    name: 'car',
    origin: [-65, 0, 2],
    parts: CAR_PARTS,
    pose: CAR_POSE,
    rationale: 'a car crossing the plaza with its lamps lit',
    triggers: ['a car', 'car driving', 'driving', 'a taxi', 'taxi', 'coche', 'carro', 'auto', 'taxi cruzando'],
    covers: ['car', 'driving', 'drives', 'crossing', 'coche', 'carro', 'auto', 'taxi', 'plaza'],
  },
  {
    name: 'tree',
    origin: [-65, 0, 2],
    parts: TREE_PARTS,
    pose: TREE_POSE,
    rationale: 'a tree in the plaza, swaying',
    triggers: ['a tree', 'tree', 'arbol', 'árbol'],
    covers: ['tree', 'trees', 'arbol', 'árbol', 'swaying', 'plaza'],
  },
  {
    name: 'dog',
    // Left of the frame's centre, 160 units out, and this is projected rather than
    // guessed — three attempts at guessing cost an hour.
    //
    // The camera stands at radius 165, height 25, and looks at a point on a radius of
    // 70 offset 0.42 radians round; the prompt and the log sit in the middle-bottom of
    // what it sees. Anything standing on the ground is below the horizon and therefore
    // low in frame, so the way past the interface is sideways, not further: this is 150
    // units along the view axis and 110 to one side of it, which lands the rig clear of
    // the text and inside the building ring where nothing occludes it. Which side took
    // a screenshot to settle: the first sign put it under the verification panel, and
    // three.js is right-handed with -Z forward, which is the kind of thing that is
    // faster to look at than to reason about.
    //
    // It drifts as the camera orbits, which is correct. A figure pinned to the frame
    // would be a sprite; this one is standing somewhere.
    origin: [-65, 0, 2],
    parts: DOG_PARTS,
    pose: `${WALK_PREAMBLE}${DOG_POSE}`,
    rationale: 'a dog trotting across the near plaza',
    triggers: ['dog', 'puppy', 'perro'],
  },
  {
    name: 'walker',
    // Left of the frame's centre, 160 units out, and this is projected rather than
    // guessed — three attempts at guessing cost an hour.
    //
    // The camera stands at radius 165, height 25, and looks at a point on a radius of
    // 70 offset 0.42 radians round; the prompt and the log sit in the middle-bottom of
    // what it sees. Anything standing on the ground is below the horizon and therefore
    // low in frame, so the way past the interface is sideways, not further: this is 150
    // units along the view axis and 110 to one side of it, which lands the rig clear of
    // the text and inside the building ring where nothing occludes it. Which side took
    // a screenshot to settle: the first sign put it under the verification panel, and
    // three.js is right-handed with -Z forward, which is the kind of thing that is
    // faster to look at than to reason about.
    //
    // It drifts as the camera orbits, which is correct. A figure pinned to the frame
    // would be a sprite; this one is standing somewhere.
    origin: [-65, 0, 2],
    parts: PERSON_PARTS,
    pose: `${WALK_PREAMBLE}${PERSON_POSE}`,
    rationale: 'a figure walking the promenade below the towers',
    triggers: ['person', 'someone', 'a figure', 'pedestrian', 'man walking', 'woman walking', 'persona', 'alguien', 'gente'],
  },
];

/**
 * The first rig whose trigger appears in the text.
 *
 * Longest trigger first, so "walking the dog" wins over "dog" — the pair is a better
 * answer to a request that named both than either half is.
 */
export function matchFigure(text: string): FigureSpec | null {
  const haystack = text.toLowerCase();
  let best: { figure: FigureSpec; length: number } | null = null;
  for (const figure of FIGURES) {
    for (const trigger of figure.triggers) {
      if (!haystack.includes(trigger)) continue;
      if (!best || trigger.length > best.length) best = { figure, length: trigger.length };
    }
  }
  return best?.figure ?? null;
}
