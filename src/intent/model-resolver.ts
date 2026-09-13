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
import type { LanguageModel, ModelRequest } from './model.js';

/** Built from the catalogue at call time so the enum can never drift from what exists. */
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
    reading: z.string(),
    primitives: z.array(z.object({
      name: z.enum(names as [string, ...string[]]),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.array(z.number())])),
    })),
    unaddressed: z.array(z.string()),
    rationale: z.string(),
  });
}

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

  async propose(request: ModelRequest): Promise<string> {
    const names = request.catalogue.map((c) => c.name);
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
      output_config: { effort: this.#effort, format: zodOutputFormat(selectionSchema(names)) },
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
    return JSON.stringify(response.parsed_output);
  }
}
