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

You are not writing Three.js. You have four shapes, positions, rotations and a scale,
and a function of time. Everything else — geometry, materials, the scene — is not yours
to touch and not available to you.

Rules, in order of importance:

1. IT MUST MOVE. A rig that stands still is the failure this whole path exists to catch,
   and the contract asserts against it: \`pose\` must change between frames. A walk cycle,
   a rotation, a drift, a flicker — something, every frame.

2. READ AS A SILHOUETTE. This is a dark city at night seen from a hundred and sixty
   units away. Detail below about half a unit is invisible; a rig of forty small parts is
   a smudge. Eight to sixteen larger parts with a clear outline is what reads.

3. SCALE TO THE WORLD. A walking figure is around 40 units tall, a car around 12 units
   high and 30 long. Something built at human scale is smaller than a pixel here.

4. STAND ON THE GROUND. y = 0 is the ground plane. A rig's parts should sit above it,
   and the whole thing moves relative to an origin the caller places.

5. WRITE PLAIN ARITHMETIC. Assignments and Math calls. No loops, no function
   declarations, no \`const\` shadowing \`t\` or \`p\`. Every value is clamped on the way out,
   so a number that escapes is contained, not catastrophic — but a pose that throws
   costs the whole candidate.

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
    // High, and this is the one call in the project that earns it. Choosing rain over
    // snow is a lookup with judgement; designing a rig that reads as a dog from a
    // hundred and sixty units away, and writing a gait for it, is design work.
    this.#effort = options.effort ?? 'high';
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
