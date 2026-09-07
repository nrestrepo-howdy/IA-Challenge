/**
 * The model-backed repair agent, verified against a stub client.
 *
 * Nothing here touches the network. R-10 wants the suite reproducible from one command
 * with no key, and this class's responsibility is the *request* — what it asks for, what
 * it refuses to accept back, and what it does when the answer never comes. The same
 * shape `tests/harness/claude-critic.test.ts` uses, for the same reason.
 */
import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { Intent } from '../../src/contracts.js';
import {
  ClaudeRepairAgent,
  resolveRepairAgent,
} from '../../src/runtime/claude-repair.js';
import { rulesRepairAgent, type RepairRequest } from '../../src/runtime/agents.js';
import { applyGuidance } from '../../src/runtime/generate.js';
import { makeIntent } from '../fixtures.js';

const intent: Intent = makeIntent({
  utterance: 'make it rain',
  brief: {
    goal: 'rain',
    rationale: 'the catalogue has an emitter for it',
    directives: [{
      name: 'rain-emitter',
      importSpecifier: 'verbo:rain-emitter',
      statePath: 'weather.rain',
      params: { count: 4000, speed: 24 },
    }],
    steps: [],
    constraints: [],
  },
});

const request: RepairRequest = {
  intent,
  attempt: 1,
  failures: [
    { candidateId: 'c0', strategy: 'direct', failedAt: 'L1', diagnosis: 'median frame 24 ms exceeds the 16 ms budget' },
    { candidateId: 'c1', strategy: 'resilient', failedAt: 'L1', diagnosis: 'median frame 25 ms exceeds the 16 ms budget' },
    { candidateId: 'c2', strategy: 'reversed', failedAt: 'L1', diagnosis: 'median frame 24 ms exceeds the 16 ms budget' },
  ],
};

const answer = {
  reading: 'all three blew the frame budget by roughly half again',
  params: [{ primitive: 'rain-emitter', param: 'count', value: 2000, reason: 'half the particles fits the budget' }],
  preferStrategies: ['resilient'],
  instructions: ['halve the particle count'],
};

function stubClient(parsed: unknown): { client: Anthropic; sent: Record<string, any>[] } {
  const sent: Record<string, any>[] = [];
  const client = {
    messages: {
      async parse(params: Record<string, any>) {
        sent.push(params);
        return { parsed_output: parsed };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

function throwingClient(): Anthropic {
  return {
    messages: {
      async parse() {
        throw new Error('connection reset');
      },
    },
  } as unknown as Anthropic;
}

describe('AC-19 · the repair agent returns parameters, and a failure to reach it never stalls the loop', () => {
  it('uses adaptive thinking at low effort, with no fixed thinking budget', async () => {
    const { client, sent } = stubClient(answer);
    await new ClaudeRepairAgent({ client }).repair(request);

    expect(sent[0]!['model']).toBe('claude-opus-5');
    expect(sent[0]!['thinking']).toEqual({ type: 'adaptive' });
    expect(sent[0]!['thinking']).not.toHaveProperty('budget_tokens');
    // Repair is spent between attempts, inside the same 40 s end-to-end budget (R-8).
    expect(sent[0]!['output_config'].effort).toBe('low');
    expect(sent[0]!['output_config'].format).toBeDefined();
    expect(sent[0]!).not.toHaveProperty('output_format');
  });

  it('sends every candidate diagnosis and the brief it has to repair', async () => {
    const { client, sent } = stubClient(answer);
    await new ClaudeRepairAgent({ client }).repair(request);

    const prompt = sent[0]!['messages'][0].content as string;
    for (const failure of request.failures) expect(prompt).toContain(failure.diagnosis);
    expect(prompt).toContain('rain-emitter');
    expect(prompt).toContain('"count":4000');
    expect(prompt).toContain('make it rain');
  });

  it('keeps the system prefix cacheable, so only the brief and the diagnoses vary', async () => {
    const { client, sent } = stubClient(answer);
    const agent = new ClaudeRepairAgent({ client });
    await agent.repair(request);
    await agent.repair({ ...request, attempt: 2 });

    expect(sent[0]!['system'][0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sent[0]!['system']).toEqual(sent[1]!['system']);
  });

  it('never asks for code — the guidance it returns is parameters and strategy order (D-2)', async () => {
    const { client, sent } = stubClient(answer);
    const guidance = await new ClaudeRepairAgent({ client }).repair(request);

    expect(JSON.stringify(sent[0]!['system'])).toContain('You do not write code');
    expect(Object.keys(guidance).sort()).toEqual(
      ['avoidStrategies', 'instructions', 'params', 'preferStrategies', 'summary'],
    );
    expect(guidance.params).toEqual(answer.params);
    // And the guidance moves the brief rather than replacing it: same directive, same
    // parameter names, one different number.
    const repaired = applyGuidance(intent.brief, guidance);
    expect(repaired.directives[0]?.params).toEqual({ count: 2000, speed: 24 });
  });

  it('takes the failed strategies from the verdicts rather than from the model', async () => {
    const { client } = stubClient({ ...answer, preferStrategies: ['direct'] });
    const guidance = await new ClaudeRepairAgent({ client }).repair(request);
    expect(guidance.avoidStrategies).toEqual(['direct', 'resilient', 'reversed']);
  });

  it('falls back to the deterministic floor when the model cannot be reached', async () => {
    const guidance = await new ClaudeRepairAgent({ client: throwingClient() }).repair(request);
    const floor = await rulesRepairAgent.repair(request);

    expect(guidance.params).toEqual(floor.params);
    expect(guidance.params.length).toBeGreaterThan(0);
    expect(guidance.instructions.at(-1)).toContain('deterministic floor');
  });

  it('falls back rather than accepting an unparseable answer', async () => {
    const { client } = stubClient(null);
    const guidance = await new ClaudeRepairAgent({ client }).repair(request);
    expect(guidance.instructions.at(-1)).toContain('deterministic floor');
  });

  it('resolves to the rules agent with no key configured, so the cycle runs offline', () => {
    const key = process.env['ANTHROPIC_API_KEY'];
    try {
      delete process.env['ANTHROPIC_API_KEY'];
      expect(resolveRepairAgent()).toBe(rulesRepairAgent);
      process.env['ANTHROPIC_API_KEY'] = 'sk-test-not-used';
      expect(resolveRepairAgent()).toBeInstanceOf(ClaudeRepairAgent);
    } finally {
      if (key === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = key;
    }
  });
});
