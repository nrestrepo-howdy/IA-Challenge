/**
 * The L3 critic, backed by a vision model.
 *
 * This is the one place in the harness where a model is allowed to look at the
 * product. It is also the one place whose opinion changes nothing on its own: R-2
 * measured external visual scoring as uncorrelated with hidden-state correctness and
 * the measured failures living in state rather than in what a picture shows, which
 * output, so D-1 made the state contract the primary oracle and left this layer as a
 * judge of taste. `AUTHORITATIVE_LAYERS` excludes L3 and `isInjectable()` enforces it.
 *
 * Given that, what this class owes the system is not a verdict but a *description*.
 * The schema is built around that:
 *
 *   1. **`observation` comes before `satisfied`.** Structured outputs are generated in
 *      field order, so the model has to say what is on the screen before it is allowed
 *      to say whether it liked it. Judging first and describing afterwards is how a
 *      critic ends up narrating the request back instead of the picture.
 *   2. **`note` is prose and nothing else.** A repair agent has to act on this; a score
 *      cannot be acted on. The same rule `FailureReport` states for every layer.
 *   3. **The prefix is stable.** System text is byte-identical across requests and only
 *      the frame and the utterance vary, so the cached prefix survives -- the idiom
 *      `ClaudeResolver` already uses.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { encodePng, toBase64 } from './png.js';
import type { Frame, VisualCritic } from './l3-perceptual.js';

const judgementSchema = z.object({
  observation: z.string(),
  satisfied: z.boolean(),
  note: z.string(),
});

const SYSTEM = `You are shown one rendered frame from a live 3D world, and the request that produced it.

Answer one question: does this picture plausibly show what was asked for?

Something else has already decided whether the code is correct -- state contracts, run
deterministically, are the authority on that. You are the only part of the system that
can see. So report what is on the screen, not what the request implies should be there.

Rules:
- "observation" is what you actually see: subjects, lighting, colour, density, where
  things sit in the frame. Describe it as if to someone who cannot look.
- "satisfied" is true when a person who asked for this would accept the picture.
- "note" is instructions for whoever has to change the code. If satisfied, say in one
  sentence what carries the request. If not, name the specific visual defect and what
  would have to be different on screen -- "the drops are behind the camera", "the fog
  is dense enough to hide the scene entirely" -- never a rating, a grade, a percentage
  or a word like "poor". A number is a failed answer: nothing downstream can act on it.
- This is a single frame, so you cannot see motion. Do not call something static
  because one frame does not move.
- An empty or nearly black frame is a real finding, not a reason to withhold judgement.`;

export interface ClaudeVisualCriticOptions {
  readonly client?: Anthropic;
  readonly model?: string;
  /**
   * Low by default. This is one judgement about one image, and R-7 already puts model
   * latency at 4-16 s -- on a layer that cannot change the outcome.
   */
  readonly effort?: 'low' | 'medium' | 'high';
}

export class ClaudeVisualCritic implements VisualCritic {
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #effort: 'low' | 'medium' | 'high';

  constructor(options: ClaudeVisualCriticOptions = {}) {
    this.#client = options.client ?? new Anthropic();
    this.#model = options.model ?? 'claude-opus-5';
    this.#effort = options.effort ?? 'low';
  }

  async judge(frame: Frame, request: string): Promise<{ satisfied: boolean; note: string }> {
    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 4096,
      // Adaptive thinking: "is this what was asked for" is a short question with a
      // genuinely ambiguous answer, and the failure that costs is a confident wrong
      // read of the frame.
      thinking: { type: 'adaptive' },
      output_config: { effort: this.#effort, format: zodOutputFormat(judgementSchema) },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          // Image before text: the model reads the picture, then the question about it.
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: toBase64(encodePng(frame)) },
          },
          { type: 'text', text: `The request was: ${request}` },
        ],
      }],
    });

    if (!response.parsed_output) {
      // Thrown rather than smoothed into a pass. An unmade check must never read as an
      // approved one, and the caller is the only thing that knows how to say so
      // without stalling the cycle.
      throw new Error('visual critic returned no parseable judgement');
    }
    const { observation, satisfied, note } = response.parsed_output;
    return {
      satisfied,
      // The observation travels with the note: a repair agent told "the drops are
      // invisible" acts better when it also knows what the model did see instead.
      note: satisfied ? note : `${note} (what the frame shows: ${observation})`,
    };
  }
}
