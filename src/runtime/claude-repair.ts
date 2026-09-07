/**
 * The repair agent, backed by a language model.
 *
 * This is the second of the two judgement calls WS2 admits to (see agents.ts), and the
 * one that closes the loop: without it the cycle re-emits the same three modules and
 * calls the second one a retry. Reading three diagnoses and deciding what to do
 * differently is genuinely a judgement, which is why a model is here at all.
 *
 * What it is *not* allowed to do is the load-bearing part. D-2 closed the surface
 * because R-1 puts open-ended Three.js synthesis near a 28% hit rate, so this agent
 * never returns code. It returns numbers for parameters that already exist and an order
 * for strategies that already exist — the schema has no field for source, and
 * `applyGuidance()` in generate.ts ignores anything that does not match something the
 * brief already carries. A model that decided to invent a primitive cannot express it,
 * and if it could, nothing would read it.
 *
 * Three properties are shared with `ClaudeResolver`, deliberately:
 *
 *   1. **The enums are built from the intent.** Structured outputs constrain generation
 *      at the token level, so a primitive name outside this brief is unrepresentable
 *      rather than merely rejected downstream.
 *   2. **The prefix is stable.** System text and the strategy catalogue are
 *      byte-identical across calls; only the brief and the diagnoses vary, so the cached
 *      prefix survives across the attempts of one cycle — which is exactly when this
 *      agent is called more than once.
 *   3. **A model failure degrades, never blocks.** Any throw falls back to
 *      `rulesRepairAgent`, so AC-19 stays a property of the loop's shape rather than of
 *      the network being up.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { rulesRepairAgent, type RepairAgent, type RepairGuidance, type RepairRequest } from './agents.js';
import { STRATEGIES } from './generate.js';

/**
 * Built per request from the brief in hand.
 *
 * `param` cannot be an enum keyed to its own `primitive` — one schema cannot make one
 * field's allowed values depend on another's — so the union of every parameter name in
 * the brief is as tight as constrained decoding gets here, and `applyGuidance()` drops a
 * pairing that does not exist. Field order matters too: `reading` is generated before
 * any adjustment, so the model has to say what went wrong before it may prescribe.
 */
function repairSchema(primitives: readonly string[], params: readonly string[]) {
  const names = primitives.length ? primitives : ['none'];
  const keys = params.length ? params : ['none'];
  return z.object({
    reading: z.string(),
    params: z.array(z.object({
      primitive: z.enum(names as [string, ...string[]]),
      param: z.enum(keys as [string, ...string[]]),
      value: z.union([z.number(), z.array(z.number())]),
      reason: z.string(),
    })),
    preferStrategies: z.array(z.enum(STRATEGIES.map((s) => s.name) as [string, ...string[]])),
    instructions: z.array(z.string()),
  });
}

const SYSTEM = `You repair a failed attempt at composing a 3D world from a fixed catalogue of primitives.

Another system already generated code, ran it, and verified it. Every candidate failed.
You are given the brief it composed from and every candidate's diagnosis, and you decide
what the next attempt should do differently.

You do not write code. The generator emits modules from templates; the only things you
can change are the parameters passed to primitives already in the brief, and the order
the strategies are tried in. There is no field for source, and a parameter or primitive
that is not already in the brief will be ignored.

The layer that rejected tells you what kind of mistake it was:
- L0 rejected the module's shape: it did not parse, reached for a forbidden global, or
  wrote outside its declared scope. Parameters cannot fix this; strategy order can,
  because the strategies compose differently.
- L1 rejected its cost: frame time, draw calls, or a hang. The direction is down — fewer
  particles, less density, less work per frame.
- L2 rejected its behaviour against the state contract, which is the authority here. The
  common cause is a primitive that mounted but did not move enough to be witnessed: read
  the diagnosis for which assertion failed and which way the value has to go.
- L3 is taste and never blocks anything. Treat it as advisory.

Rules:
- "reading" is one or two sentences on what the diagnoses have in common. Write it first.
- Move a parameter only when a diagnosis gives you a reason to. Two considered changes
  beat eight speculative ones.
- Stay near the value you are replacing: it already validated against the catalogue's
  declared range, and a value more than double or less than half of it will be clamped.
- "reason" is what a person reading the log needs, in prose. Never a score, a rating or a
  confidence: nothing downstream can act on a number.
- "instructions" is what you would tell the next attempt, one line each.`;

export interface ClaudeRepairAgentOptions {
  readonly client?: Anthropic;
  readonly model?: string;
  /**
   * Low by default. Repair sits inside the same 40 s end-to-end budget as everything
   * else (R-8), and it is spent *between* attempts — the one place in the cycle where
   * latency is paid more than once. The question is narrow as well: the diagnoses
   * already say what broke, so this is a decision, not a design.
   */
  readonly effort?: 'low' | 'medium' | 'high';
  /** Where a model failure lands. The deterministic floor, unless a caller says otherwise. */
  readonly fallback?: RepairAgent;
}

export class ClaudeRepairAgent implements RepairAgent {
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #effort: 'low' | 'medium' | 'high';
  readonly #fallback: RepairAgent;

  constructor(options: ClaudeRepairAgentOptions = {}) {
    this.#client = options.client ?? new Anthropic();
    this.#model = options.model ?? 'claude-opus-5';
    this.#effort = options.effort ?? 'low';
    this.#fallback = options.fallback ?? rulesRepairAgent;
  }

  async repair(request: RepairRequest): Promise<RepairGuidance> {
    try {
      return await this.#ask(request);
    } catch {
      // Swallowed deliberately, and this is the one place in WS2 where that is right:
      // the alternative to a degraded repair is no next attempt at all. AC-19 promises a
      // bounded loop that reports, not a loop that reports only while the API answers.
      const floor = await this.#fallback.repair(request);
      return {
        ...floor,
        instructions: [
          ...floor.instructions,
          'the model-backed repair agent was unavailable, so this guidance is the deterministic floor',
        ],
      };
    }
  }

  async #ask(request: RepairRequest): Promise<RepairGuidance> {
    const { directives } = request.intent.brief;
    const params = [...new Set(directives.flatMap((d) => Object.keys(d.params)))];
    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 4096,
      // Adaptive thinking: three diagnoses can disagree about what went wrong, and the
      // failure that costs an attempt is a confident repair in the wrong direction.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: this.#effort,
        format: zodOutputFormat(repairSchema(directives.map((d) => d.name), params)),
      },
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `STRATEGIES\n${JSON.stringify(STRATEGIES.map((s) => s.name))}` },
      ],
      messages: [{ role: 'user', content: describe(request) }],
    });

    if (!response.parsed_output) {
      throw new Error('repair agent returned no parseable guidance');
    }
    const parsed = response.parsed_output;
    return {
      summary:
        `attempt ${request.attempt} produced no injectable candidate for ` +
        `'${request.intent.utterance}': ${parsed.reading}`,
      instructions: parsed.instructions,
      // Not asked of the model: which strategies failed is a fact of the verdicts, and
      // asking for a fact the caller already holds is a way of getting it wrong.
      avoidStrategies: [...new Set(request.failures.map((f) => f.strategy))],
      params: parsed.params,
      preferStrategies: parsed.preferStrategies,
    };
  }
}

/** The varying half of the prompt: this brief, these diagnoses. */
function describe(request: RepairRequest): string {
  return [
    `REQUEST: ${request.intent.utterance}`,
    `ATTEMPT ${request.attempt} of the cycle failed. Every candidate was rejected.`,
    '',
    'BRIEF',
    ...request.intent.brief.directives.map(
      (d) => `- ${d.name} at ${d.statePath} with ${JSON.stringify(d.params)}`,
    ),
    '',
    'DIAGNOSES',
    ...request.failures.map(
      (f) => `- strategy '${f.strategy}' rejected at ${f.failedAt ?? 'injection'}: ${f.diagnosis}`,
    ),
  ].join('\n');
}

/**
 * The repair agent this environment can actually run.
 *
 * There is no key in a browser and there must not be one, so the live cycle runs on the
 * deterministic floor unless a caller hands it a client — which is precisely why that
 * floor has to move parameters rather than merely narrate. The nightly evaluation and
 * anything Node-side run where a key exists and get the model-backed agent.
 */
export function resolveRepairAgent(options: ClaudeRepairAgentOptions = {}): RepairAgent {
  if (options.client) return new ClaudeRepairAgent(options);
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (!env?.['ANTHROPIC_API_KEY']) return rulesRepairAgent;
  return new ClaudeRepairAgent(options);
}
