/**
 * Model-backed resolution: utterance -> catalogue selection.
 *
 * The one place in Verbo where a language model earns its keep. Everything downstream
 * is deterministic -- the brief becomes a module by template, the oracles are code,
 * injection is code -- so a model failure degrades to a rejection rather than to
 * broken code reaching the world.
 *
 * Three properties of the schema are load-bearing:
 *
 *   1. **Primitive names are an enum built from the catalogue.** Structured outputs
 *      constrain generation at the token level, so a name outside the catalogue is not
 *      merely rejected downstream -- it is unrepresentable. D-2 said the agent composes
 *      rather than invents; this is that rule expressed where it cannot be forgotten,
 *      and the enum is derived from the catalogue so it cannot drift from it.
 *
 *   2. **`unaddressed` is required.** Constrained decoding guarantees *shape*, never
 *      *meaning*: a schema cannot stop a model from answering a different question.
 *      Night one of the evaluation caught exactly that -- "make it rain money" was
 *      accepted because `rain` matched and `money` was silently dropped. Requiring the
 *      model to enumerate what it could not express turns a silent omission into a
 *      value the caller is forced to handle.
 *
 *   3. **The prefix is stable.** System text and catalogue are byte-identical across
 *      requests and only the utterance varies, so the cached prefix survives. A
 *      timestamp or a shuffled catalogue in here would silently cost a cache hit on
 *      every call.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { PrimitiveSpec } from './catalogue.js';
import type { LanguageModel, ModelRequest } from './model.js';

/**
 * The params half of a primitive's schema, as Zod, derived from the catalogue entry.
 *
 * This exists because of a failure that looked exactly like laziness. `params` was
 * `z.record(...)`, an open map: valid JSON Schema, and structurally correct, but it
 * declares *no field names*. A model generating into it is handed an object with no
 * boxes, so it closes the brace. Every mood request came back with real thinking in
 * `reading` — "noche de tormenta: oscuridad nocturna, lluvia intensa empujada por el
 * viento y relámpagos" — and then `daylight {}`, which the compiler filled with
 * defaults, and defaults for `daylight` are noon. A storm at midday, from a model that
 * had correctly understood it was night.
 *
 * Naming the fields is the fix: `phase` and `transition` are boxes, and a box that
 * exists gets filled. Derived here rather than written out for the same reason the
 * name enum is derived — a schema kept in step with the catalogue by hand is a schema
 * that drifts the first time someone adds a primitive.
 */
function zodParams(spec: PrimitiveSpec) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(spec.schema.properties)) {
    if (prop.type === 'string') {
      shape[key] = z.enum(prop.enum as [string, ...string[]]);
    } else if (prop.type === 'array') {
      shape[key] = z
        .array(z.number())
        .describe(`${prop.minItems} numbers, each ${prop.items.minimum}..${prop.items.maximum}`);
    } else {
      // Every bound is described, none is constrained, and `.int()` in particular is
      // not used. Constrained decoding compiles numeric bounds into the grammar, and
      // Zod gives an integer the full safe-integer range — so `count: integer` arrives
      // as a sixteen-digit min and max that the decoder must check digit by digit.
      // Four of those across the catalogue is a grammar the API refuses outright:
      // "The compiled grammar is too large". Nothing is lost by describing instead:
      // `schema.ts` validates every parameter against the catalogue — type, integrality
      // and range — before a line of code is generated, so a bad number is rejected
      // with a reason rather than silently accepted. The grammar's only job here is to
      // name the fields, because a field with no name never gets filled.
      shape[key] = z
        .number()
        .describe(`${prop.type === 'integer' ? 'whole number ' : ''}${prop.minimum}..${prop.maximum}`);
    }
  }
  return z.object(shape);
}

/**
 * Step one: *what* to compose. Names only, no parameters.
 *
 * Built from the catalogue at call time so the enum can never drift from what exists.
 */
function selectionSchema(names: readonly string[]) {
  return z.object({
    /**
     * First on purpose. Structured output generates fields in declaration order, so a
     * field's position is an instruction channel: whatever comes first is what the
     * model works out before it commits to anything after it.
     *
     * `rationale` used to be last, and the first live run returned the literal string
     * "placeholder" — the model had already chosen and was filling in a box. Asking it
     * to read the request aloud before selecting is the cheapest reasoning step
     * available and it costs one short field.
     */
    reading: z
      .string()
      .describe('What is being asked, in your own words: the mood, the light, the weather.'),
    primitives: z
      .array(z.enum(names as [string, ...string[]]))
      .describe('Three or four for a mood; one only when the request names one concrete thing.'),
    unaddressed: z
      .array(z.string())
      .describe('Parts of the request the catalogue cannot express, quoted from it.'),
    rationale: z
      .string()
      .describe("Why this composition produces what was asked, in the user's language."),
  });
}

/**
 * Step two: *how much*. One key per primitive already chosen, each with that
 * primitive's real parameter names.
 */
function paramsSchema(specs: readonly PrimitiveSpec[]) {
  return z.object(Object.fromEntries(specs.map((spec) => [spec.name, zodParams(spec)])));
}

const PARAMS_SYSTEM = `You are setting the parameters for primitives that have already been
chosen for a request about a 3D world. The choice is made; your only job is the numbers.

Defaults are a neutral reading of the catalogue, not of the request. Heavy, dim, vast,
gentle, distant, violent — each of those is a number somewhere, and moving it is the
whole of your job. Every parameter must get a value inside its stated range, and a
composition where every value sits at the middle of its range is one you did not think
about. Read the interpretation you are given and make the numbers say the same thing.`;

const SYSTEM = `You turn a request about a 3D world into a composition of primitives from a
fixed catalogue. The world is a night city: buildings, ground, sky, weather, light.

Think of yourself as a lighting and atmosphere director, not a lookup table. Someone
who says "make it feel like a memory" is not naming a primitive — they are naming a
*feeling*, and your job is to decide which combination of weather, time of day, colour
and light produces it. That is the whole reason you are here instead of a keyword matcher.

Rules, in order of importance:

1. COMPOSE. A request that names a mood, a film, a place or a feeling almost always
   needs THREE OR FOUR primitives working together — time of day sets the palette,
   weather sets the mood, and one more gives it character. One primitive is the right
   answer only when the request names one concrete thing ("add fog", "raise a tower").
   A single primitive returned for an evocative request is a failure of nerve.

2. SET PARAMETERS. Defaults are a neutral reading of the catalogue, not of the request.
   If someone asks for something heavy, dim, vast or gentle, move the numbers that say
   so, inside their declared ranges. An empty params object on a mood request means you
   did not actually interpret anything.

3. DISCLOSE. Every meaningful part of the request the catalogue cannot express MUST
   appear in "unaddressed", quoted from the request. Returning an empty "unaddressed"
   while quietly ignoring half of what was asked is the worst failure available to you:
   the caller will report success for something it did not do.

   The test is whether the composition produces it, not whether one primitive is named
   after it. "a storm" is addressed by rain, wind and lightning together; listing it as
   unaddressed because no primitive is called "storm" tells the user you failed at the
   exact moment you succeeded. Only what the catalogue genuinely cannot reach — a
   submarine, a crowd, a specific building — belongs here.

4. "reading" comes first and is where you work out what was actually asked — the mood,
   the reference, what it should feel like. Two sentences at most. "rationale" is one
   sentence for a human reading a log, in the language the request was written in.

You compose; you never invent. If the catalogue cannot express the request at all,
return no primitives and say why in "rationale" — that is a good answer, not a failure.`;

export interface ClaudeResolverOptions {
  readonly client?: Anthropic;
  readonly model?: string;
  /** Low by default: this is resolution, not design, and latency is a product requirement (R-8). */
  readonly effort?: 'low' | 'medium' | 'high';
}

export class ClaudeResolver implements LanguageModel {
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #effort: 'low' | 'medium' | 'high';

  constructor(options: ClaudeResolverOptions = {}) {
    this.#client = options.client ?? new Anthropic();
    this.#model = options.model ?? 'claude-opus-5';
    // Medium, not low. Resolving "make it feel like a memory" into weather, palette
    // and light is a genuinely ambiguous creative judgement; at low effort the first
    // live runs returned one primitive, no parameters and an empty rationale. The cost
    // is a second or two inside a 40 s budget (R-8) and it buys the difference between
    // a lookup and an interpretation.
    this.#effort = options.effort ?? 'medium';
  }

  /**
   * Two calls: what, then how much.
   *
   * One call would be better and is not available. Naming a primitive's parameters in
   * the grammar is the only thing that makes the model fill them — with an open
   * `record` it composes correctly and returns `{}` for every one, at any effort, under
   * any instruction, because a field with no name has no box to fill. But a grammar
   * that names all fifteen primitives' parameters at once is refused: constrained
   * decoding admits an object's keys in any order, so k keys cost k! paths, and the
   * cost multiplies down the tree. A bisect put the ceiling between eight and eleven
   * keys; grouping the fifteen by `statePath` to stay under it was refused too.
   *
   * Splitting it puts both calls comfortably inside the limit — the first names no
   * parameters, the second names only the three or four primitives that were chosen —
   * and the split falls where the reasoning already divides. Choosing rain over snow
   * and deciding how hard it falls are different judgements, and the second reads the
   * first's interpretation rather than re-deriving it.
   */
  async propose(request: ModelRequest): Promise<string> {
    const chosen = await this.#choose(request);
    const specs = request.catalogue.filter((c) => chosen.primitives.includes(c.name));
    // No primitives is a real answer (AC-17), and there is nothing to parameterise.
    if (specs.length === 0) return JSON.stringify({ ...chosen, primitives: [] });

    const params = await this.#parameterise(request, chosen, specs);
    return JSON.stringify({
      ...chosen,
      primitives: specs.map((spec) => ({ name: spec.name, params: params[spec.name] ?? {} })),
    });
  }

  async #choose(request: ModelRequest): Promise<{
    readonly reading: string;
    readonly primitives: readonly string[];
    readonly unaddressed: readonly string[];
    readonly rationale: string;
  }> {
    const response = await this.#client.messages.parse({
      model: this.#model,
      // Adaptive thinking is billed inside max_tokens, so 4096 at medium effort left
      // almost nothing for the answer: the first tuned run returned `daylight` with an
      // empty rationale and an empty unaddressed for three different mood requests —
      // a truncated generation that looks exactly like a lazy one. The failure mode is
      // indistinguishable from a bad prompt, which is why it cost an hour to find.
      max_tokens: 16000,
      // Adaptive thinking: resolution is short but genuinely ambiguous, and the
      // failure that costs is a confident wrong pick, not a slow right one.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: this.#effort,
        format: zodOutputFormat(selectionSchema(request.catalogue.map((c) => c.name))),
      },
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `CATALOGUE\n${JSON.stringify(request.catalogue)}` },
      ],
      messages: [{
        role: 'user',
        content: request.worldPaths.length
          ? `${request.utterance}\n\n(the world already exposes: ${request.worldPaths.join(', ')})`
          : request.utterance,
      }],
    });
    if (!response.parsed_output) {
      // A rejection, not an exception with a stack trace: the compiler turns this into
      // an explained refusal (AC-17), which is what the user should see.
      throw new Error('resolver returned no parseable selection');
    }
    return response.parsed_output;
  }

  async #parameterise(
    request: ModelRequest,
    chosen: { readonly reading: string; readonly primitives: readonly string[] },
    specs: readonly PrimitiveSpec[],
  ): Promise<Record<string, Record<string, unknown>>> {
    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      // Low, deliberately. The judgement that needed effort — which primitives, and
      // why — has been made and is passed in below. This is scaling numbers to an
      // interpretation someone else already wrote down, and it sits on the latency
      // budget of every utterance (R-8).
      output_config: { effort: 'low', format: zodOutputFormat(paramsSchema(specs)) },
      system: [
        { type: 'text', text: PARAMS_SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `PRIMITIVES\n${JSON.stringify(specs)}` },
      ],
      messages: [{
        role: 'user',
        content: `Request: ${request.utterance}\n\nInterpretation: ${chosen.reading}\n\nSet the parameters for: ${chosen.primitives.join(', ')}`,
      }],
    });
    if (!response.parsed_output) throw new Error('resolver returned no parseable parameters');
    return response.parsed_output as Record<string, Record<string, unknown>>;
  }

}
