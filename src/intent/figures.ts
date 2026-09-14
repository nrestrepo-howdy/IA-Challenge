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
const TROUSER: readonly [number, number, number] = [0.11, 0.12, 0.17];
const MUZZLE: readonly [number, number, number] = [0.26, 0.18, 0.11];
const STRAP: readonly [number, number, number] = [0.5, 0.13, 0.1];

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
  // Eight heads, laid out against the canon rather than by eye: crotch at the halfway
  // line, knee at a fifth, shoulders two heads across, fingertips at mid-thigh.
  { id: 'head', shape: 'sphere', size: [HEAD * 0.4, HEAD * 0.5, HEAD * 0.42], color: SKIN, emissive: 0.2 },
  { id: 'neck', shape: 'cylinder', size: [HEAD * 0.15, HEAD * 0.22, HEAD * 0.15], color: SKIN, emissive: 0.16 },
  // Chest and waist rather than one capsule. A single torso is a fridge: it has no
  // shoulder line and no waist, so the silhouette carries nothing and the eye reads a
  // container instead of a body. Two segments is the cheapest taper there is.
  { id: 'chest', shape: 'capsule', size: [HEAD * 0.86, HEAD * 0.75, HEAD * 0.46], color: COAT, emissive: 0.16 },
  { id: 'waist', shape: 'capsule', size: [HEAD * 0.64, HEAD * 0.66, HEAD * 0.4], color: COAT, emissive: 0.16 },
  { id: 'hips', shape: 'capsule', size: [HEAD * 0.72, HEAD * 0.4, HEAD * 0.44], color: TROUSER, emissive: 0.12 },
  // Outboard of the chest by a clear margin: at the chest's own half-width the arm is
  // tangent to it and reads as a seam, not a limb.
  { id: 'arm-l', shape: 'capsule', size: [HEAD * 0.17, HEAD * 0.75, HEAD * 0.17], color: COAT, emissive: 0.16 },
  { id: 'arm-r', shape: 'capsule', size: [HEAD * 0.17, HEAD * 0.75, HEAD * 0.17], color: COAT, emissive: 0.16 },
  { id: 'forearm-l', shape: 'capsule', size: [HEAD * 0.14, HEAD * 0.9, HEAD * 0.14], color: SKIN, emissive: 0.16 },
  { id: 'forearm-r', shape: 'capsule', size: [HEAD * 0.14, HEAD * 0.9, HEAD * 0.14], color: SKIN, emissive: 0.16 },
  { id: 'thigh-l', shape: 'capsule', size: [HEAD * 0.23, HEAD, HEAD * 0.23], color: TROUSER, emissive: 0.12 },
  { id: 'thigh-r', shape: 'capsule', size: [HEAD * 0.23, HEAD, HEAD * 0.23], color: TROUSER, emissive: 0.12 },
  { id: 'shin-l', shape: 'capsule', size: [HEAD * 0.18, HEAD * 0.79, HEAD * 0.18], color: TROUSER, emissive: 0.12 },
  { id: 'shin-r', shape: 'capsule', size: [HEAD * 0.18, HEAD * 0.79, HEAD * 0.18], color: TROUSER, emissive: 0.12 },
  // Feet, because a leg that ends in a rounded tip reads as a peg and nothing stands
  // on a peg. They also give the ground contact a shadow with an edge.
  { id: 'foot-l', shape: 'box', size: [HEAD * 0.2, HEAD * 0.11, HEAD * 0.48], color: [0.08, 0.08, 0.1], emissive: 0.1 },
  { id: 'foot-r', shape: 'box', size: [HEAD * 0.2, HEAD * 0.11, HEAD * 0.48], color: [0.08, 0.08, 0.1], emissive: 0.1 },
];

/**
 * A dog, at a scale a dog actually is: about sixteen units at the shoulder, which is
 * two-fifths of the person beside it. The first one was a tenth of the person and read
 * as a rat on a lead.
 */
const DOG_PARTS: readonly FigurePart[] = [
  // A medium dog at the world's scale: 0.9 m nose to tail, 0.5 at the shoulder. The
  // body runs along z and the pose pitches it there, which is why its long extent is
  // written in y — a capsule's axis.
  { id: 'body', shape: 'capsule', size: [2.0, 6.0, 2.0], color: FUR, emissive: 0.24 },
  { id: 'chest', shape: 'capsule', size: [2.3, 2.0, 2.3], color: FUR, emissive: 0.24 },
  { id: 'neck', shape: 'cylinder', size: [1.15, 2.0, 1.15], color: FUR, emissive: 0.24 },
  { id: 'head', shape: 'box', size: [1.5, 1.35, 1.9], color: FUR, emissive: 0.26 },
  { id: 'muzzle', shape: 'box', size: [0.78, 0.6, 1.5], color: MUZZLE, emissive: 0.3 },
  // Upright, on top of the skull and behind the eye line. Laid flat along the head they
  // vanished into it; stood at the front they read as horns.
  { id: 'ear-l', shape: 'wedge', size: [0.2, 1.0, 0.72], color: MUZZLE, emissive: 0.24 },
  { id: 'ear-r', shape: 'wedge', size: [0.2, 1.0, 0.72], color: MUZZLE, emissive: 0.24 },
  { id: 'leg-fl', shape: 'cylinder', size: [0.5, 3.0, 0.5], color: FUR, emissive: 0.22 },
  { id: 'leg-fr', shape: 'cylinder', size: [0.5, 3.0, 0.5], color: FUR, emissive: 0.22 },
  { id: 'leg-bl', shape: 'cylinder', size: [0.55, 3.0, 0.55], color: FUR, emissive: 0.22 },
  { id: 'leg-br', shape: 'cylinder', size: [0.55, 3.0, 0.55], color: FUR, emissive: 0.22 },
  { id: 'tail', shape: 'capsule', size: [0.34, 2.0, 0.34], color: FUR, emissive: 0.24 },
];

/**
 * The gait, written once for the new anatomy.
 *
 * `leg` walks the promenade up and back; `w` is the phase of the stride. Limbs are
 * placed at joints rather than at fixed offsets, so the elbow and the knee land where
 * the segment above them ends — which is the whole reason the arms were split in two.
 */
/**
 * The leash — one cylinder, and the reason the pair rig reads as what it is.
 *
 * A figure and an animal standing near each other is a figure and an animal; the strap
 * between them is what makes it a person walking a dog, and it is the detail the
 * perceptual critic kept asking for by name. It is also the cheapest possible: the dog
 * holds a fixed station beside the walker, so the hand-to-collar distance never changes
 * and the part can be authored at that length and merely aimed.
 *
 * Aiming it is the only arithmetic here. A cylinder's axis is +Y; under the YXZ order
 * the renderer uses, a pitch of `acos(dy/L)` tilts that axis down by the right amount
 * and a yaw of `atan2(dx, dz)` swings it onto the bearing. Uniform scale is all a pose
 * can set, so the length has to be authored rather than computed — which is exactly why
 * the station is fixed.
 */
const LEASH_PARTS: readonly FigurePart[] = [
  { id: 'leash', shape: 'cylinder', size: [0.16, 6.6, 0.16], color: STRAP, emissive: 0.3 },
];

const LEASH_POSE = `
  // Both ends in the walker's frame, so the strap is aimed once and turned with
  // everything else. The hand end comes out of the arm chain rather than being guessed
  // at, so it stays in the hand through the swing instead of drifting off it.
  const hx = -5.0, hy = handRy, hz = handRz;
  const cx = -16, cy = by + 2.4, cz = 7.0;
  const ex = cx - hx, ey = cy - hy, ez = cz - hz;
  const len = Math.max(0.001, Math.sqrt(ex * ex + ey * ey + ez * ez));
  put(0, (hx + cx) / 2, (hy + cy) / 2, (hz + cz) / 2);
  p[0].pitch = Math.acos(Math.max(-1, Math.min(1, ey / len)));
  p[0].yaw = facing + Math.atan2(ex, ez);
  // Stretched to span the gap it is aimed across. The length was authored as a constant
  // on the assumption that a fixed station means a fixed distance, and the arm swing
  // makes that false: the strap fell short of the hand for most of the stride, which
  // leaves the walker and the dog as two unconnected bodies. Uniform scale is the only
  // lever a pose has and it fattens the strap as well — from 0.16 to about 0.18, which
  // nothing can see, against a length error that everything can.
  p[0].scale = len / 13.2;
`;

const WALK_PREAMBLE = `
  // A flat oval, not a line with a flip at each end.
  //
  // The walk used to pace a straight segment and reverse by setting \`facing\` from 0 to
  // pi between one frame and the next: a person spinning 180 degrees instantly, and the
  // dog teleporting to their other side. There is no smoothing that fixes that, because
  // the path itself has a cusp — a body walking a line has to stop and turn, and a rig
  // has no way to stop.
  //
  // An oval has no cusp. Heading is the direction of travel and is therefore defined,
  // continuous and correct at every instant, and the turn happens because the walker is
  // walking a curve, which is what someone pacing a plaza actually does.
  const phase = t * 0.19;
  const path = 75 * Math.sin(phase);
  const cross = 26 * Math.cos(phase);
  const facing = Math.atan2(-26 * Math.sin(phase), 75 * Math.cos(phase));
  const cf = Math.cos(facing), sf = Math.sin(facing);
  const w = t * 3.1;
  const swing = Math.sin(w);
  const bob = Math.abs(Math.sin(w)) * 0.9;
  // Every part is placed in the walker's own frame — x across, z along the direction of
  // travel — and turned into the world here. Writing world coordinates directly is what
  // made the old pose need a \`facing\` branch in every line.
  const put = (i, lx, ly, lz) => {
    p[i].x = cross + lx * cf + lz * sf;
    p[i].y = ly;
    p[i].z = path - lx * sf + lz * cf;
    p[i].yaw = facing;
  };
`;

/**
 * Eight heads, laid out from the ground up: shins 0-8.8, thighs to 18, hips at 19.5,
 * torso 20-33.5, neck, head centred at 36.5. The arms hang outboard of the shoulder at
 * x = 5.6 against a torso half-width of 4.9, which is the difference between an arm and
 * a bulge in a capsule.
 */
const PERSON_POSE = `
  // Forward kinematics, not absolute placement.
  //
  // Setting a part's position AND its rotation independently is a contradiction:
  // rotating a segment about its centre moves both of its ends, so the elbow the upper
  // arm actually reaches is not the elbow the forearm was told to sit at. The gaps
  // opened and closed through the stride, which is why they read as the rig coming
  // apart rather than as a constant offset.
  //
  // Here a joint is computed once and the next segment is hung off it. A capsule's axis
  // is +Y, and under the renderer's YXZ order a pitch of theta carries that axis to
  // (0, cos theta, sin theta) — so a segment of half-length h whose top end is at J has
  // its centre at J - h*(0, cos, sin) and its far end at J - 2h*(0, cos, sin). That one
  // line is the whole rig: shoulder to elbow to hand, hip to knee to ankle.
  //
  // Both components take the minus. Writing the y term as a subtraction and the z term
  // as an addition — the natural thing to type, since one reads as "downward" and the
  // other as "forward" — hinges the joint the wrong way and the limb below it swings
  // out sideways on screen while staying connected in the arithmetic.
  const sh = 33.3, hipY = 19.3;
  const ua = 3.75, fa = 4.5, th = 5.0, sn = 3.95;

  put(0, 0, 37.4 + bob, 0);
  put(1, 0, 34.4 + bob, 0);
  put(2, 0, 29.6 + bob, 0); p[2].roll = swing * 0.05;
  put(3, 0, 23.0 + bob, 0); p[3].roll = swing * 0.03;
  put(4, 0, hipY + bob, 0);

  // Arms. The elbow keeps a little bend at every phase, because a straight arm through
  // a whole stride is the single clearest sign of a puppet.
  const aL = swing * 0.42, aR = -swing * 0.42;
  const eLy = sh + bob - 2 * ua * Math.cos(aL), eLz = -2 * ua * Math.sin(aL);
  const eRy = sh + bob - 2 * ua * Math.cos(aR), eRz = -2 * ua * Math.sin(aR);
  const bL = aL + 0.34, bR = aR + 0.34;
  put(5, 5.0, sh + bob - ua * Math.cos(aL), -ua * Math.sin(aL)); p[5].pitch = aL;
  put(6, -5.0, sh + bob - ua * Math.cos(aR), -ua * Math.sin(aR)); p[6].pitch = aR;
  put(7, 5.0, eLy - fa * Math.cos(bL), eLz - fa * Math.sin(bL)); p[7].pitch = bL;
  put(8, -5.0, eRy - fa * Math.cos(bR), eRz - fa * Math.sin(bR)); p[8].pitch = bR;
  const handLy = eLy - 2 * fa * Math.cos(bL), handLz = eLz - 2 * fa * Math.sin(bL);
  const handRy = eRy - 2 * fa * Math.cos(bR), handRz = eRz - 2 * fa * Math.sin(bR);

  // Legs. The knee only ever bends one way, so the shin angle is the thigh's plus a
  // bend that is largest as the leg swings through and nearly nothing as it takes
  // weight — which is what stops the figure from walking on stilts.
  const tL = -swing * 0.52, tR = swing * 0.52;
  const kL = tL + 0.12 + Math.max(0, -swing) * 0.62, kR = tR + 0.12 + Math.max(0, swing) * 0.62;
  const kLy = hipY - 2 * th * Math.cos(tL), kLz = -2 * th * Math.sin(tL);
  const kRy = hipY - 2 * th * Math.cos(tR), kRz = -2 * th * Math.sin(tR);
  put(9, 2.5, hipY - th * Math.cos(tL), -th * Math.sin(tL)); p[9].pitch = tL;
  put(10, -2.5, hipY - th * Math.cos(tR), -th * Math.sin(tR)); p[10].pitch = tR;
  put(11, 2.5, kLy - sn * Math.cos(kL), kLz - sn * Math.sin(kL)); p[11].pitch = kL;
  put(12, -2.5, kRy - sn * Math.cos(kR), kRz - sn * Math.sin(kR)); p[12].pitch = kR;
  // Feet hang off the ankle the way every other segment hangs off its joint. Pinning
  // them to y = 0.55 left them on the pavement while the leg above lifted through the
  // swing — a gap of about an authored unit, four centimetres at world scale, hidden
  // behind the near leg at most camera angles and caught by the connectivity check
  // rather than by looking. They still cannot go through the floor.
  const ankLy = kLy - 2 * sn * Math.cos(kL), ankLz = kLz - 2 * sn * Math.sin(kL);
  const ankRy = kRy - 2 * sn * Math.cos(kR), ankRz = kRz - 2 * sn * Math.sin(kR);
  put(13, 2.5, Math.max(0.55, ankLy - 0.55), ankLz + 1.1);
  put(14, -2.5, Math.max(0.55, ankRy - 0.55), ankRz + 1.1);
`;

/**
 * The dog, trotting on diagonal pairs — front-left with back-right, which is what a dog
 * actually does and what stops four legs moving like a pantomime horse.
 */
const DOG_POSE = `
  // Laid out in the walker's frame, tail to nose along +z, always on their left. The
  // dog used to pick its side from a boolean that flipped at each end of the walk,
  // which teleported it across the leash twice a lap.
  const trot = w * 1.7;
  const lift = Math.abs(Math.sin(trot)) * 0.45;
  // 0.7 m off the walker's centre line — a leash's length, not a shoulder's. At 0.43 the
  // dog was inside the swing of the near leg and the two silhouettes merged.
  const dx = -16;
  const by = 8.2 + lift;
  put(0, dx, by, 0); p[0].pitch = Math.PI / 2;
  put(1, dx, by + 0.4, 5.6); p[1].pitch = Math.PI / 2;
  put(2, dx, by + 2.6, 7.2); p[2].pitch = 0.85;
  put(3, dx, by + 4.6, 8.9); p[3].pitch = 0.12;
  put(4, dx, by + 3.9, 11.0);
  put(5, dx + 1.0, by + 6.2, 8.4);
  put(6, dx - 1.0, by + 6.2, 8.4);
  // Legs under the body, not outboard of it: a dog is narrow, and splayed legs read as
  // a table. The diagonal pairs swing together, which is what a trot is.
  // Hung off the body rather than pinned to the ground: the body bobs on the trot and
  // the legs did not follow it, so all four detached at the top of every stride.
  const legY = by - 4.6;
  put(7, dx + 1.15, legY, 4.4); p[7].pitch = Math.sin(trot) * 0.62;
  put(8, dx - 1.15, legY, 4.4); p[8].pitch = -Math.sin(trot) * 0.62;
  put(9, dx + 1.25, legY, -4.4); p[9].pitch = -Math.sin(trot) * 0.62;
  put(10, dx - 1.25, legY, -4.4); p[10].pitch = Math.sin(trot) * 0.62;
  put(11, dx, by + 2.2, -7.2); p[11].pitch = 1.05 + Math.sin(w * 5) * 0.4;
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

/**
 * Renumber a pose body so it can be concatenated after another rig's.
 *
 * `p` is one flat array across both rigs, so the second rig's `p[0]` is really
 * `p[<parts in the first rig>]`. Writing that offset as a literal is how the pair rig
 * broke: the person grew from six parts to twelve and the offset stayed at six, so the
 * dog was writing its legs into the person's — which renders as a person with no legs
 * standing over a pile of loose sticks, with nothing in state to suggest a fault.
 *
 * The count now comes from the array, and the pattern takes `\d+` rather than `\d`,
 * because a one-digit pattern silently skips `p[10]` and leaves it pointing at whatever
 * part ten belongs to in the other rig.
 *
 * Both ways of addressing a part have to be renumbered. A pose places most parts through
 * `put(i, …)` and reaches for `p[i]` only to add a rotation, so renumbering one and not
 * the other puts the second rig's body on the first rig's indices while its pitches land
 * correctly — the exact failure this function exists to prevent, wearing a new hat.
 */
function shifted(pose: string, by: number): string {
  return pose
    .replace(/p\[(\d+)\]/g, (_, d: string) => `p[${Number(d) + by}]`)
    .replace(/\bput\((\d+),/g, (_, d: string) => `put(${Number(d) + by},`);
}

const STEEL: readonly [number, number, number] = [0.34, 0.09, 0.08];
const GLASS: readonly [number, number, number] = [0.08, 0.1, 0.14];
const BARK: readonly [number, number, number] = [0.22, 0.16, 0.1];
const LEAF: readonly [number, number, number] = [0.1, 0.2, 0.11];

/** A car: body, cabin, four wheels, two headlights and two tail lights. */
const CAR_PARTS: readonly FigurePart[] = [
  // A saloon at the world's scale: 4.5 m long, 1.8 wide, 1.5 to the roof. The rig was
  // authored at a quarter of that, from before the figures were metric, which rendered
  // a car the size of a briefcase parked on a road eleven metres across.
  { id: 'body', shape: 'box', size: [50, 8, 20], color: STEEL, emissive: 0.12 },
  { id: 'cabin', shape: 'box', size: [21, 7.5, 18], color: GLASS, emissive: 0.18 },
  { id: 'wheel-fl', shape: 'cylinder', size: [7, 3, 7], color: [0.06, 0.06, 0.07] },
  { id: 'wheel-fr', shape: 'cylinder', size: [7, 3, 7], color: [0.06, 0.06, 0.07] },
  { id: 'wheel-bl', shape: 'cylinder', size: [7, 3, 7], color: [0.06, 0.06, 0.07] },
  { id: 'wheel-br', shape: 'cylinder', size: [7, 3, 7], color: [0.06, 0.06, 0.07] },
  // The lamps are the whole reason a car reads at night. They are the brightest thing
  // in the rig by a wide margin and they carry the direction of travel on their own.
  { id: 'lamp-l', shape: 'sphere', size: [3.6, 3.6, 3.6], color: [1, 0.94, 0.78], emissive: 1 },
  { id: 'lamp-r', shape: 'sphere', size: [3.6, 3.6, 3.6], color: [1, 0.94, 0.78], emissive: 1 },
  { id: 'tail-l', shape: 'sphere', size: [2.4, 2.4, 2.4], color: [1, 0.12, 0.08], emissive: 0.9 },
  { id: 'tail-r', shape: 'sphere', size: [2.4, 2.4, 2.4], color: [1, 0.12, 0.08], emissive: 0.9 },
];

/**
 * The drive: down the promenade and back, with the rig turning at each end.
 *
 * `facing` is a yaw of 0 or pi rather than a smooth turn, because a car that pivots
 * over two seconds at this distance reads as a glitch, and one that cuts reads as a cut.
 */
const CAR_POSE = `
  const speed = 120;
  // A 360-unit lap — about sixteen metres each way — so the drive stays on the plaza.
  // The first version swung 150 units either way from an origin already 65 out, which
  // drove the car into the building ring, and the camera followed it there.
  const leg = ((t * speed) % 360) - 180;
  const out = leg > 0;
  const path = out ? 180 - leg * 2 : 180 + leg * 2;
  const facing = out ? Math.PI : 0;
  const dir = out ? -1 : 1;
  const roll = t * 9;
  p[0].y = 13; p[0].z = path; p[0].yaw = facing;
  p[1].y = 25; p[1].z = path - dir * 5; p[1].yaw = facing;
  p[2].y = 7; p[2].z = path + dir * 17; p[2].x = 11; p[2].roll = Math.PI / 2; p[2].pitch = roll;
  p[3].y = 7; p[3].z = path + dir * 17; p[3].x = -11; p[3].roll = Math.PI / 2; p[3].pitch = roll;
  p[4].y = 7; p[4].z = path - dir * 17; p[4].x = 11; p[4].roll = Math.PI / 2; p[4].pitch = roll;
  p[5].y = 7; p[5].z = path - dir * 17; p[5].x = -11; p[5].roll = Math.PI / 2; p[5].pitch = roll;
  p[6].y = 13; p[6].z = path + dir * 26; p[6].x = 7.6;
  p[7].y = 13; p[7].z = path + dir * 26; p[7].x = -7.6;
  p[8].y = 13.5; p[8].z = path - dir * 26; p[8].x = 7.6;
  p[9].y = 13.5; p[9].z = path - dir * 26; p[9].x = -7.6;
`;

/** A tree: trunk and three staggered canopies, breathing in the wind. */
const TREE_PARTS: readonly FigurePart[] = [
  // Matched to the street trees the city already plants — a nine-metre canopy — so a
  // tree someone asks for stands beside the ones that were always there instead of
  // beside them at a tenth their height.
  { id: 'trunk', shape: 'cylinder', size: [4, 46, 4], color: BARK },
  { id: 'canopy-low', shape: 'sphere', size: [38, 38, 38], color: LEAF, emissive: 0.1 },
  { id: 'canopy-mid', shape: 'sphere', size: [32, 32, 32], color: LEAF, emissive: 0.1 },
  { id: 'canopy-top', shape: 'sphere', size: [24, 24, 24], color: LEAF, emissive: 0.12 },
];

/**
 * A tree does not travel, so the motion has to be somewhere else or the contract's
 * `changesOverTime` assertion rejects it — correctly. It sways.
 */
const TREE_POSE = `
  const sway = Math.sin(t * 0.9) * 0.055 + Math.sin(t * 2.3) * 0.018;
  p[0].y = 46; p[0].roll = sway * 0.4;
  p[1].y = 80; p[1].x = sway * 46; p[1].z = Math.sin(t * 1.1) * 7;
  p[2].y = 111; p[2].x = sway * 77; p[2].z = Math.sin(t * 1.1 + 0.4) * 11;
  p[3].y = 137; p[3].x = sway * 108; p[3].z = Math.sin(t * 1.1 + 0.8) * 13;
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
    parts: [...prefixed(PERSON_PARTS, 'walker'), ...prefixed(DOG_PARTS, 'dog'), ...LEASH_PARTS],
    pose: `${WALK_PREAMBLE}${PERSON_POSE}${shifted(DOG_POSE, PERSON_PARTS.length)}${shifted(LEASH_POSE, PERSON_PARTS.length + DOG_PARTS.length)}`,
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
