import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: class MockBedrockRuntimeClient {
      send = mockSend;
    },
    InvokeModelCommand: class MockInvokeModelCommand {
      constructor(public input: unknown) {}
    },
  };
});

vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');
vi.stubEnv('FIGURES_ASSIST_MODEL_ID', 'us.anthropic.claude-sonnet-5-5');

import { handler, buildSuggestPrompt, buildCheckPrompt, parseCandidates } from './index';

function makePostEvent(body: string | null) {
  return { httpMethod: 'POST', resource: '/ai/figures-assist', headers: {}, body };
}

function bedrockResponse(text: string): { body: Uint8Array } {
  return {
    body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] })),
  };
}

/** The prompt text sent in the n-th Bedrock call, and the model id used. */
function invokeOf(callIndex = 0): { prompt: string; modelId: string } {
  const input = mockSend.mock.calls[callIndex][0].input as Record<string, unknown>;
  const body = JSON.parse(input['body'] as string) as { messages: Array<{ content: string }> };
  return { prompt: body.messages[0].content, modelId: input['modelId'] as string };
}

describe('Figures Assist Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- pure prompt builders (no Bedrock) ---

  describe('buildSuggestPrompt', () => {
    it('carries only the student scroll text, notes, and taxonomy; forbids interpretation', () => {
      const p = buildSuggestPrompt('In the day of the Lord...', 'my note', [
        'metaphor',
        'hyperbole',
      ]);
      expect(p).toContain('In the day of the Lord...');
      expect(p).toContain('my note');
      expect(p).toContain('metaphor, hyperbole');
      expect(p.toLowerCase()).toContain('never');
    });
  });

  describe('buildCheckPrompt', () => {
    it('carries the student type/reference/text and names the student as judge', () => {
      const p = buildCheckPrompt('hyperbole', '5:2', 'a thief in the night');
      expect(p).toContain('hyperbole');
      expect(p).toContain('5:2');
      expect(p).toContain('a thief in the night');
      expect(p.toLowerCase()).toContain('judge');
    });
  });

  describe('parseCandidates', () => {
    it('parses a JSON array, tolerating a surrounding code fence', () => {
      const raw =
        '```json\n[{"reference":"5:2","suggestedType":"metaphor","reason":"image of theft"}]\n```';
      const out = parseCandidates(raw);
      expect(out).toEqual([
        { reference: '5:2', suggestedType: 'metaphor', reason: 'image of theft' },
      ]);
    });

    it('drops items without a reference and returns [] on garbage', () => {
      expect(parseCandidates('[{"suggestedType":"metaphor"}]')).toEqual([]);
      expect(parseCandidates('not json at all')).toEqual([]);
    });
  });

  // --- handler: suggest ---

  describe('POST suggest', () => {
    it('invokes the per-stage model and returns parsed candidates', async () => {
      mockSend.mockResolvedValueOnce(
        bedrockResponse('[{"reference":"5:2","suggestedType":"metaphor","reason":"theft image"}]'),
      );
      const res = await handler(
        makePostEvent(
          JSON.stringify({ action: 'suggest', scrollText: 'text here', types: ['metaphor'] }),
        ),
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).candidates).toEqual([
        { reference: '5:2', suggestedType: 'metaphor', reason: 'theft image' },
      ]);
      expect(invokeOf(0).modelId).toBe('us.anthropic.claude-sonnet-5-5');
    });

    it('returns 400 without scrollText', async () => {
      const res = await handler(makePostEvent(JSON.stringify({ action: 'suggest' })));
      expect(res.statusCode).toBe(400);
    });

    it('degrades to 200 { degraded } on a Bedrock error, never 500', async () => {
      mockSend.mockRejectedValueOnce(new Error('bedrock down'));
      const res = await handler(
        makePostEvent(JSON.stringify({ action: 'suggest', scrollText: 'text' })),
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.degraded).toBe(true);
      expect(body.candidates).toEqual([]);
    });
  });

  // --- handler: check ---

  describe('POST check', () => {
    it('returns advice from the model', async () => {
      mockSend.mockResolvedValueOnce(bedrockResponse('Reads more like metonymy. You decide.'));
      const res = await handler(
        makePostEvent(
          JSON.stringify({ action: 'check', figureType: 'metaphor', reference: '5:2', text: 'x' }),
        ),
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).advice).toContain('metonymy');
    });

    it('returns 400 without figureType', async () => {
      const res = await handler(
        makePostEvent(JSON.stringify({ action: 'check', reference: '5:2' })),
      );
      expect(res.statusCode).toBe(400);
    });

    it('degrades to 200 { degraded } on a Bedrock error', async () => {
      mockSend.mockRejectedValueOnce(new Error('throttled'));
      const res = await handler(
        makePostEvent(
          JSON.stringify({ action: 'check', figureType: 'metaphor', reference: '5:2' }),
        ),
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).degraded).toBe(true);
    });
  });

  // --- handler: validation ---

  it('rejects a missing/unknown action', async () => {
    expect((await handler(makePostEvent(JSON.stringify({ action: 'nope' })))).statusCode).toBe(400);
    expect((await handler(makePostEvent(JSON.stringify({})))).statusCode).toBe(400);
  });

  it('rejects a missing body and malformed JSON', async () => {
    expect((await handler(makePostEvent(null))).statusCode).toBe(400);
    expect((await handler(makePostEvent('{bad'))).statusCode).toBe(400);
  });
});
