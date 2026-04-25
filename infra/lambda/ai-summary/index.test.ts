import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Bedrock client before importing the handler
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

// Set env vars before importing handler
vi.stubEnv('ALLOWED_ORIGIN', 'https://example.cloudfront.net');

import { handler, generateStudySummary } from './index';
import type { WordStudyEntry } from '../shared/models';

function makePostEvent(body: string | null) {
  return {
    httpMethod: 'POST',
    resource: '/ai/study-summary',
    body,
  };
}

function makeEntry(overrides: Partial<WordStudyEntry> = {}): WordStudyEntry {
  return {
    word: 'love',
    strongsNumber: 'G25',
    strongsDefinition: 'to love (in a social or moral sense)',
    englishDefinition: 'an intense feeling of deep affection',
    originalWord: 'ἀγαπάω',
    transliteration: 'agapaō',
    lexiconEntry: 'From ἀγάπη; to love...',
    crossReferences: [],
    aiSummary: '',
    notes: '',
    ...overrides,
  };
}

function bedrockResponse(text: string): { body: Uint8Array } {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ type: 'text', text }] }),
    ),
  };
}

describe('AI Summary Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- generateStudySummary function ---

  describe('generateStudySummary', () => {
    it('returns AI summary text on successful Bedrock invocation', async () => {
      const summaryText =
        'The Greek word ἀγαπάω (agapaō) represents a deliberate, self-sacrificial love.';
      mockSend.mockResolvedValueOnce(bedrockResponse(summaryText));

      const result = await generateStudySummary(makeEntry());
      expect(result).toBe(summaryText);
    });

    it('returns fallback message when Bedrock throws an error', async () => {
      mockSend.mockRejectedValueOnce(new Error('Service unavailable'));

      const result = await generateStudySummary(makeEntry());
      expect(result).toBe('AI summary unavailable. Please try again later.');
    });

    it('returns fallback message when Bedrock returns empty content', async () => {
      mockSend.mockResolvedValueOnce(
        bedrockResponse(''),
      );

      const result = await generateStudySummary(makeEntry());
      expect(result).toBe('AI summary unavailable. Please try again later.');
    });

    it('returns fallback message when Bedrock response has no content array', async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(JSON.stringify({})),
      });

      const result = await generateStudySummary(makeEntry());
      expect(result).toBe('AI summary unavailable. Please try again later.');
    });

    it('includes user cross-reference observations in the prompt', async () => {
      const entry = makeEntry({
        crossReferences: [
          { reference: 'John 3:16', notes: 'God loved the world sacrificially' },
          { reference: 'Romans 5:8', notes: 'Love demonstrated while still sinners' },
        ],
      });

      mockSend.mockResolvedValueOnce(bedrockResponse('Summary with observations.'));

      await generateStudySummary(entry);

      // Verify the prompt sent to Bedrock includes the observations
      const invokeInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      const bodyStr = invokeInput['body'] as string;
      const body = JSON.parse(bodyStr) as { messages: Array<{ content: string }> };
      const prompt = body.messages[0].content;

      expect(prompt).toContain('John 3:16: God loved the world sacrificially');
      expect(prompt).toContain('Romans 5:8: Love demonstrated while still sinners');
    });

    it('handles empty cross-reference notes by showing "None provided"', async () => {
      const entry = makeEntry({
        crossReferences: [
          { reference: 'John 3:16', notes: '' },
          { reference: 'Romans 5:8', notes: '   ' },
        ],
      });

      mockSend.mockResolvedValueOnce(bedrockResponse('Summary without observations.'));

      await generateStudySummary(entry);

      const invokeInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      const bodyStr = invokeInput['body'] as string;
      const body = JSON.parse(bodyStr) as { messages: Array<{ content: string }> };
      const prompt = body.messages[0].content;

      expect(prompt).toContain('None provided');
      expect(prompt).not.toContain('John 3:16:');
    });

    it('handles missing cross-references array gracefully', async () => {
      const entry = makeEntry({ crossReferences: [] });

      mockSend.mockResolvedValueOnce(bedrockResponse('Summary with no refs.'));

      const result = await generateStudySummary(entry);
      expect(result).toBe('Summary with no refs.');
    });

    it('never throws even with non-Error rejection', async () => {
      mockSend.mockRejectedValueOnce('unexpected string error');

      const result = await generateStudySummary(makeEntry());
      expect(result).toBe('AI summary unavailable. Please try again later.');
    });
  });

  // --- Handler: request validation ---

  describe('handler request validation', () => {
    it('returns 400 when body is null', async () => {
      const res = await handler(makePostEvent(null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/body/i);
    });

    it('returns 400 when body is invalid JSON', async () => {
      const res = await handler(makePostEvent('not json'));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/invalid json/i);
    });

    it('returns 400 when word is missing', async () => {
      const body = JSON.stringify({
        strongsNumber: 'G25',
        strongsDefinition: 'to love',
      });
      const res = await handler(makePostEvent(body));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/word/i);
    });

    it('returns 400 when strongsNumber is missing', async () => {
      const body = JSON.stringify({
        word: 'love',
        strongsDefinition: 'to love',
      });
      const res = await handler(makePostEvent(body));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/strongsNumber/i);
    });

    it('returns 400 when strongsDefinition is missing', async () => {
      const body = JSON.stringify({
        word: 'love',
        strongsNumber: 'G25',
      });
      const res = await handler(makePostEvent(body));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/strongsDefinition/i);
    });
  });

  // --- Handler: successful responses ---

  describe('handler success', () => {
    it('returns 200 with summary on successful Bedrock call', async () => {
      const summaryText = 'A concise study summary.';
      mockSend.mockResolvedValueOnce(bedrockResponse(summaryText));

      const res = await handler(makePostEvent(JSON.stringify(makeEntry())));
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.summary).toBe(summaryText);
    });

    it('returns 200 with fallback message when Bedrock fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Bedrock timeout'));

      const res = await handler(makePostEvent(JSON.stringify(makeEntry())));
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.summary).toBe('AI summary unavailable. Please try again later.');
    });
  });

  // --- CORS headers ---

  describe('CORS headers', () => {
    it('includes CORS headers on success responses', async () => {
      mockSend.mockResolvedValueOnce(bedrockResponse('Summary.'));

      const res = await handler(makePostEvent(JSON.stringify(makeEntry())));
      expect(res.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
    });

    it('includes CORS headers on error responses', async () => {
      const res = await handler(makePostEvent(null));
      expect(res.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});
