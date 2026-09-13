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

export interface FigurePart {
  readonly id: string;
  readonly shape: 'box' | 'sphere' | 'capsule' | 'cylinder';
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

/** A walking person: torso, head, two arms, two legs, and a counter-swinging gait. */
const PERSON_PARTS: readonly FigurePart[] = [
  { id: 'torso', shape: 'capsule', size: [5.46, 7.14, 3.57], color: COAT, emissive: 0.2 },
  { id: 'head', shape: 'sphere', size: [3.57, 3.57, 3.57], color: SKIN, emissive: 0.34 },
  { id: 'arm-l', shape: 'capsule', size: [1.51, 5.67, 1.51], color: COAT, emissive: 0.2 },
  { id: 'arm-r', shape: 'capsule', size: [1.51, 5.67, 1.51], color: COAT, emissive: 0.2 },
  { id: 'leg-l', shape: 'capsule', size: [1.99, 6.51, 1.99], color: [0.12, 0.13, 0.18], emissive: 0.12 },
  { id: 'leg-r', shape: 'capsule', size: [1.99, 6.51, 1.99], color: [0.12, 0.13, 0.18], emissive: 0.12 },
];

/** A dog: body, head, muzzle, four legs, a tail that never stops. */
const DOG_PARTS: readonly FigurePart[] = [
  { id: 'body', shape: 'capsule', size: [3.15, 5.04, 2.94], color: FUR, emissive: 0.3 },
  { id: 'head', shape: 'box', size: [2.10, 1.89, 1.99], color: FUR, emissive: 0.3 },
  { id: 'muzzle', shape: 'box', size: [0.88, 0.71, 1.47], color: [0.28, 0.19, 0.12], emissive: 0.3 },
  { id: 'leg-fl', shape: 'cylinder', size: [0.63, 2.31, 0.63], color: FUR, emissive: 0.3 },
  { id: 'leg-fr', shape: 'cylinder', size: [0.63, 2.31, 0.63], color: FUR, emissive: 0.3 },
  { id: 'leg-bl', shape: 'cylinder', size: [0.63, 2.31, 0.63], color: FUR, emissive: 0.3 },
  { id: 'leg-br', shape: 'cylinder', size: [0.63, 2.31, 0.63], color: FUR, emissive: 0.3 },
  { id: 'tail', shape: 'capsule', size: [0.46, 1.89, 0.46], color: FUR, emissive: 0.22 },
];

/**
 * The walk, written once and shared.
 *
 * `w` is the phase of the gait and `path` the distance travelled along the promenade.
 * Both figures walk the same line at the same speed because one of them is on a lead.
 */
const WALK_PREAMBLE = `
  const speed = 4.6;
  // A short promenade, walked up and back rather than a loop. The camera orbits the
  // city on a five-minute cycle, so a figure that walks away in a straight line is out
  // of frame before anyone has read the log; a figure that paces stays where it can be
  // seen and still moves enough to prove it is alive.
  const leg = ((t * speed) % 150) - 75;
  const path = leg > 0 ? 75 - leg * 2 : 75 + leg * 2;
  const facing = leg > 0 ? Math.PI : 0;
  const w = t * 3.4;
`;

const PERSON_POSE = `
  const bob = Math.abs(Math.sin(w)) * 0.5;
  p[0].y = 19.3 + bob * 2; p[0].z = path; p[0].x = 8; p[0].yaw = facing;
  p[1].y = 28.1 + bob * 2; p[1].z = path + Math.sin(w * 2) * 0.25; p[1].x = 8;
  // Arms counter-swing against the legs, which is most of what makes a walk read.
  p[2].y = 20.2 + bob * 2; p[2].z = path; p[2].x = 13.5; p[2].pitch = Math.sin(w) * 0.55;
  p[3].y = 20.2 + bob * 2; p[3].z = path; p[3].x = 2.5; p[3].pitch = -Math.sin(w) * 0.55;
  p[4].y = 8.4; p[4].z = path + Math.sin(w) * 3.2; p[4].x = 10.5; p[4].pitch = -Math.sin(w) * 0.6;
  p[5].y = 8.4; p[5].z = path - Math.sin(w) * 3.2; p[5].x = 5.5; p[5].pitch = Math.sin(w) * 0.6;
`;

const DOG_POSE = `
  const trot = w * 1.7;
  const lift = Math.abs(Math.sin(trot)) * 0.22;
  p[0].y = 6.5 + lift; p[0].z = path - 11; p[0].x = -7; p[0].roll = Math.PI / 2;
  p[1].y = 8.2 + lift; p[1].z = path - 7.2; p[1].x = -7;
  p[2].y = 7.6 + lift; p[2].z = path - 5.4; p[2].x = -7;
  // Diagonal pairs, which is how a dog actually trots: front-left with back-right.
  p[3].y = 2.5; p[3].z = path - 8.8; p[3].x = -5.6; p[3].pitch = Math.sin(trot) * 0.8;
  p[4].y = 2.5; p[4].z = path - 8.8; p[4].x = -8.4; p[4].pitch = -Math.sin(trot) * 0.8;
  p[5].y = 2.5; p[5].z = path - 13.6; p[5].x = -5.6; p[5].pitch = -Math.sin(trot) * 0.8;
  p[6].y = 2.5; p[6].z = path - 13.6; p[6].x = -8.4; p[6].pitch = Math.sin(trot) * 0.8;
  p[7].y = 8.4; p[7].z = path - 15.2; p[7].x = -7; p[7].pitch = 0.7 + Math.sin(w * 5) * 0.5;
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
