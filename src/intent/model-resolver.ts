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
    primitives: z.array(z.object({
      name: z.enum(names as [string, ...string[]]),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.array(z.number())])),
    })),
    unaddressed: z.array(z.string()),
    rationale: z.string(),
  });
}

const SYSTEM = `You resolve a request about a 3D world into primitives from a fixed catalogue.

You compose; you never invent. The catalogue is closed: if the world cannot express
something, name it in "unaddressed" rather than approximating it with whatever is
nearest.

Rules:
- Pick the fewest primitives that genuinely satisfy the request.
- Every meaningful part of the request that the catalogue cannot express MUST appear in
  "unaddressed", quoted from the request. Returning an empty "unaddressed" while
  ignoring part of the request is the worst failure available to you: the caller will
  report success for something it did not do.
- Parameters must respect the declared ranges. Prefer the default unless the request
  gives a reason to move it.
- "rationale" is one sentence, for a human reading a log.`;

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
    this.#effort = options.effort ?? 'low';
  }

  async propose(request: ModelRequest): Promise<string> {
    const names = request.catalogue.map((c) => c.name);
    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 4096,
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
