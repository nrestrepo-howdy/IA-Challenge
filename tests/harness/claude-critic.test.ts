import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeVisualCritic } from '../../src/harness/claude-critic.js';
import type { Frame } from '../../src/harness/l3-perceptual.js';

const frame: Frame = {
  width: 8, height: 4,
  data: new Uint8ClampedArray(8 * 4 * 4).fill(200),
};

/**
 * A stub client, not a network call. The critic is the only part of the harness that
 * reaches the internet, and R-10 wants the suite reproducible from one command with
 * no key -- so what is asserted here is the *request*, which is the part this class
 * is actually responsible for.
 */
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

describe('AC-11 · the L3 critic asks for a description, not a score', () => {
  it('sends the frame as a PNG image block placed before the question', async () => {
    const { client, sent } = stubClient({ observation: 'rain', satisfied: true, note: 'drops fall across the frame' });
    await new ClaudeVisualCritic({ client }).judge(frame, 'make it rain');

    const content = sent[0]!['messages'][0].content;
    expect(content[0].type).toBe('image');
    expect(content[0].source.media_type).toBe('image/png');
    expect(content[0].source.data).not.toMatch(/[\r\n]/);
    expect(content[1].type).toBe('text');
    expect(content[1].text).toContain('make it rain');
  });

  it('uses adaptive thinking at low effort, with no fixed thinking budget', async () => {
    const { client, sent } = stubClient({ observation: 'rain', satisfied: true, note: 'fine' });
    await new ClaudeVisualCritic({ client }).judge(frame, 'make it rain');

    expect(sent[0]!['model']).toBe('claude-opus-5');
    expect(sent[0]!['thinking']).toEqual({ type: 'adaptive' });
    expect(sent[0]!['thinking']).not.toHaveProperty('budget_tokens');
    // R-7 puts critic latency at 4-16 s for a judgement that cannot change the outcome.
    expect(sent[0]!['output_config'].effort).toBe('low');
    expect(sent[0]!['output_config'].format).toBeDefined();
    expect(sent[0]!).not.toHaveProperty('output_format');
  });

  it('keeps the system prefix cacheable, so only the frame and the request vary', async () => {
    const { client, sent } = stubClient({ observation: 'rain', satisfied: true, note: 'fine' });
    const critic = new ClaudeVisualCritic({ client });
    await critic.judge(frame, 'make it rain');
    await critic.judge(frame, 'make it snow');

    expect(sent[0]!['system'][0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sent[0]!['system']).toEqual(sent[1]!['system']);
  });

  it('attaches what the model saw to a dissatisfied note, so the repair is specific', async () => {
    const { client } = stubClient({
      observation: 'an empty grey sky with no particles',
      satisfied: false,
      note: 'nothing that reads as rain reaches the visible frame',
    });
    const judged = await new ClaudeVisualCritic({ client }).judge(frame, 'make it rain');
    expect(judged.satisfied).toBe(false);
    expect(judged.note).toContain('nothing that reads as rain');
    expect(judged.note).toContain('empty grey sky');
  });

  it('throws rather than passing when nothing parseable came back', async () => {
    const { client } = stubClient(null);
    // The caller turns this into "appearance was not judged". An unmade check must
    // never be smoothed into an approved one.
    await expect(new ClaudeVisualCritic({ client }).judge(frame, 'make it rain'))
      .rejects.toThrow(/no parseable judgement/);
  });
});
