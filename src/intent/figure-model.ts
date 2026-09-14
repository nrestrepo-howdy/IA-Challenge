/**
 * The model as author of a rig, rather than as chooser of a primitive.
 *
 * `figures.ts` holds three rigs written by hand, and three rigs is a phrasebook, not a
 * world: it answers "un perro con una persona paseando" and not "un coche rojo cruzando
 * la plaza". This is the path that answers the second one, and it is the only place in
 * the project where the model writes code that runs.
 *
 * The surface it writes against is deliberately narrow, because the width of that
 * surface is the whole risk. It names shapes from a set of four, gives them sizes and
 * colours that are validated per part before anything runs, and supplies the body of
 * `pose(t, parts)` — arithmetic over a fixed-length array. It cannot import, cannot
 * reach the scene, and cannot name a geometry. What it can still do is write an
 * infinite loop, which is exactly the failure L1 exists for: the candidate runs in a
 * worker and the worker is killed (AC-08), so a pose that will not return costs one
 * rejected candidate rather than a frozen page.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { FigureSpec } from './figures.js';
import { SHAPES } from '../world/figure.js';

/** Authors a rig for an utterance the catalogue cannot express, or declines. */
export interface FigureAuthor {
  author(utterance: string): Promise<FigureSpec | null>;
}

const schema = z.object({
  /**
   * First, for the same reason the resolver's `reading` is first: structured output
   * generates in declaration order, so what comes first is what the model works out
   * before it commits to anything after it. A rig designed after the part list is a
   * part list with a description attached.
   */
  subject: z
    .string()
    .describe('What is being asked for, and how it should read as a silhouette. One or two sentences.'),
  name: z
    .string()
    .describe('Lowercase and dashed, 1-40 chars. It becomes the state path, figures.<name>.'),
  parts: z
    .array(
      z.object({
        id: z.string().describe('Unique within the rig, lowercase and dashed.'),
        shape: z.enum(SHAPES as unknown as [string, ...string[]]),
        size: z
          .array(z.number())
          .describe('Three half-extents in world units. A walking figure is about 40 tall overall, so a torso is near [2.6, 3.4, 1.7]. Nothing above 40.'),
        color: z.array(z.number()).describe('Three numbers, 0..1, linear RGB.'),
        emissive: z
          .number()
          .describe('0..1. The world is a night city; 0.2 to 0.4 is what makes a shape readable against it, and 1 is a lamp.'),
      }),
    )
    .describe('At most 48. Fewer, larger parts read better at this distance than many small ones.'),
  pose: z
    .string()
    .describe(
      'The BODY of (t, p) => { ... }, as JavaScript. `t` is elapsed seconds; `p` is one target per part in declaration order, each with x, y, z, yaw, pitch, roll and scale, reset to rest before every call. Set positions in world units relative to the rig origin. No loops, no declarations outside the body, no imports, no globals beyond Math.',
    ),
  rationale: z.string().describe("One sentence for a human reading a log, in the language the request was written in."),
});

const SYSTEM = `You build a rig: a small set of typed shapes and the arithmetic that moves
them, for a world that is a night city seen from street level among towers about 300
units tall.

You are not writing Three.js. You have eight shapes, positions, rotations and a scale,
and a function of time. Everything else — geometry, materials, the scene — is not yours
to touch and not available to you.

## Think in silhouette

At this distance nobody sees your surfaces. They see an outline, and an outline is made
of shapes that point somewhere. Before you list a single part, decide what the thing
looks like as a **black shape against the sky**, then build that.

The commonest failure is answering everything with boxes and spheres. Both are blobs:
they have no direction, so eleven of them in a row is eleven blobs in a row. Use the
directional shapes wherever the subject has a direction, which is almost always.

    box        a body, a slab, a container, a wall
    sphere     a head, a balloon, a canopy, anything round
    capsule    a limb, a fuselage, a torso, a branch
    cylinder   a leg, a mast, a trunk, a chimney, a wheel seen edge-on
    cone       a NOSE, a spire, a beak, a rocket, a pine tree, a funnel
    wedge      a WING, a roof, a fin, a ramp, a blade, a sail
    pyramid    a crown, a tent, a spike, a turret cap
    torus      a wheel, a ring, a lifebuoy, a halo

An aeroplane is a capsule fuselage, a **cone** nose, two **wedge** wings, a **wedge**
tail fin and a horizontal stabiliser. Not five boxes. A car is a box body, a wedge
windscreen, four torus or cylinder wheels, two bright spheres for lamps. A bird is a
capsule body, a cone beak, two wedge wings.

## Rules, in order of importance

1. IT MUST MOVE. A rig that stands still is the failure this whole path exists to catch,
   and the contract asserts against it: \`pose\` must change between frames. A walk cycle,
   a rotation, a drift, a flicker — something, every frame.

2. BUILD THE OUTLINE FIRST, THEN DETAIL. Eight to sixteen parts. The first four should
   be the ones that make it recognisable from across the plaza; anything after that is
   trim. Detail below about half a unit is invisible here — a rig of forty small parts
   is a smudge.

3. SCALE TO THE WORLD. Everything below is in your units, and they are consistent with
   each other — read it as one world, not as a list:

     a person                  40 tall
     a dog                     14 at the shoulder
     a bicycle                 40 long
     a car                    100 long, 33 high
     a bus                    260 long
     a street tree            200 tall
     a road                   240 wide, kerb to kerb
     a low building           600 tall
     the tallest towers     6,600 tall
     a light aircraft         240 long, 260 across the wings
     an airliner              900 long, 800 across the wings

   Ground is y = 0 and the whole city stands on it, so anything flying over it belongs
   between y = 5,500 and y = 9,000 — clear of the tallest tower, close enough that the
   city is still the thing it is flying over. A plane authored at y = 300 is parked on
   the road. This is the mistake to check for: a thing that should be in the air is
   almost always authored an order of magnitude too low, because 300 sounds high and
   against a 6,600-unit skyline it is ankle-deep.

4. USE THE CANON FOR PROPORTION. This is where rigs go wrong, and it is not a matter of
   taste — there are numbers, and they are old.

   A human figure is **eight heads tall**. At 40 units that head is 5, and everything
   else follows: shoulders two heads across, hips at the halfway line, elbow at the
   waist, fingertips at mid-thigh, knee at a quarter of the height. A head that is a
   quarter of the figure is a toy; the difference between 1/8 and 1/4 is the difference
   between a person and a blob, and it is the single commonest mistake here.

   Four-legged animals are about two-and-a-half body-lengths nose to tail, with legs
   about 40% of the shoulder height. A car is about three times as long as it is tall.
   A light aircraft's wingspan is roughly its length.

5. PUT LIMBS OUTSIDE THE BODY. A part at a smaller x than the torso's half-width is
   *inside* the torso and invisible. If the torso's size is [5, 6.5, 2.5], an arm
   belongs at x = ±5.6, not ±3. Check every limb against the half-width of the thing it
   hangs from — this failure renders as one featureless lump and looks like a bug in the
   engine rather than in the numbers.

6. SPLIT AT THE JOINT. An arm as a single capsule cannot bend, so a walk can only slide
   it back and forth. Upper arm plus forearm, thigh plus shin, with the lower segment
   placed where the upper one ends, is the difference between a figure that is walking
   and a figure being carried. Same for a neck between head and torso: without one the
   head sits on the shoulders like a ball on a wall.

7. ORIENT THE PARTS. \`size\` is half-extents in x, y, z, so a wing is wide in x, thin in
   y and short in z. A cone points up its own y unless you pitch or roll it: a nose on
   the front of a fuselage is a cone with \`pitch = Math.PI/2\`.

8. STAND SOMEWHERE, AND LET THE WORLD PLACE YOU. y = 0 is the ground. Things that stand
   sit above it; things that fly are well clear of it. Build the rig around x = 0, z = 0
   and facing +z — the world gives it a spot of its own and turns it to suit, and a rig
   that picks its own corner of the city ends up standing in someone else's.

9. IF IT TRAVELS, TRAVEL IN A CURVE. The tempting way to make something pace back and
   forth is a straight run with the heading flipped at each end — "facing = out ? PI : 0"
   — and it is wrong every time, because a body walking a line has to stop to turn and a
   rig cannot stop. What renders is a figure spinning 180 degrees in a single frame.

   A closed curve has no such point. Something like

     const phase = t * 0.19;
     const z = 75 * Math.sin(phase);
     const x = 26 * Math.cos(phase);
     const facing = Math.atan2(-26 * Math.sin(phase), 75 * Math.cos(phase));

   paces a flat oval, and the heading is the direction of travel — defined, continuous
   and correct at every instant, turning because the thing is walking a curve. Use it
   for anything that walks, drives, swims or circles. Something in level flight can go
   straight, but give it a wide arc rather than a reversal.

10. WRITE PLAIN ARITHMETIC. Assignments and Math calls. No loops, no function
   declarations, no \`const\` shadowing \`t\` or \`p\`. Every value is clamped on the way out,
   so a number that escapes is contained — but a pose that throws costs the candidate.

If the request is not a thing that can be built out of shapes — a smell, an emotion, an
abstraction — say so by returning no parts. That is a good answer, not a failure.`;

export interface FigureAuthorOptions {
  readonly client?: Anthropic;
  readonly model?: string;
  readonly effort?: 'low' | 'medium' | 'high';
}

export class ClaudeFigureAuthor implements FigureAuthor {
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #effort: 'low' | 'medium' | 'high';

  constructor(options: FigureAuthorOptions = {}) {
    this.#client = options.client ?? new Anthropic();
    this.#model = options.model ?? 'claude-opus-5';
    // Medium. The same request at the three settings: high took 58 s and produced 14
    // parts, medium 35 s and 13, low 16 s and 10 — and low's balloon was a plain sphere
    // where high's had painted bands, which is paying in exactly the thing this path
    // exists to be good at.
    //
    // Medium is affordable because the call no longer sits on the critical path: the
    // compiler starts it beside the resolver rather than after it (see `willLeaveGaps`).
    // Serialised, medium landed exactly on R-8's 40 s with nothing left for the cascade;
    // in parallel it hides behind a resolver that takes 12 to 20 s on its own.
    this.#effort = options.effort ?? 'medium';
  }

  async author(utterance: string): Promise<FigureSpec | null> {
    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.#effort, format: zodOutputFormat(schema) },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: utterance }],
    });
    const out = response.parsed_output;
    if (!out || out.parts.length === 0) return null;

    return {
      name: out.name,
      // Placed by the compiler, not by the model: where a rig stands is a question about
      // the camera's framing, and the model has never seen the frame.
      origin: [-65, 0, 2],
      parts: out.parts.map((p) => ({
        id: p.id,
        shape: p.shape as FigureSpec['parts'][number]['shape'],
        size: [p.size[0] ?? 1, p.size[1] ?? 1, p.size[2] ?? 1],
        color: [p.color[0] ?? 0.5, p.color[1] ?? 0.5, p.color[2] ?? 0.5],
        emissive: p.emissive,
      })),
      pose: out.pose,
      rationale: out.rationale,
      // Nothing selects a model-authored rig by keyword — the utterance already did —
      // but it answers for its own subject, so the compiler stops disclosing it.
      triggers: [],
      covers: out.subject.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3),
    };
  }
}
