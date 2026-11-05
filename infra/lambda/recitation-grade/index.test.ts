import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBedrockSend, mockS3Send, mockTranscribeSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockBedrockSend: vi.fn(),
  mockS3Send: vi.fn(),
  mockTranscribeSend: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = mockBedrockSend;
  },
  InvokeModelCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockS3Send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('@aws-sdk/client-transcribe', () => ({
  TranscribeClient: class {
    send = mockTranscribeSend;
  },
  StartTranscriptionJobCommand: class {
    constructor(public input: unknown) {}
  },
  GetTranscriptionJobCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');
vi.stubEnv('RECITATION_GRADE_MODEL_ID', 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
vi.stubEnv('RECITATION_AUDIO_BUCKET', 'uploads-bucket');

import {
  handler,
  normalizeTokens,
  scoreDiff,
  accuracyToGrade,
  buildGradePrompt,
  parseGrade,
} from './index';

const USER = 'user-123';

function makeEvent(body: unknown, sub: string | null = USER) {
  return {
    httpMethod: 'POST',
    resource: '/ai/recitation-grade',
    headers: {},
    body: body === null ? null : JSON.stringify(body),
    requestContext: sub ? { authorizer: { claims: { sub } } } : {},
  };
}

function bedrockGrade(grade: string, reason = 'ok'): { body: Uint8Array } {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ grade, reason }) }] }),
    ),
  };
}

/** Make the Transcribe mock return a COMPLETED job whose transcript file fetches to `transcript`. */
function stubTranscribe(transcript: string): void {
  mockTranscribeSend.mockImplementation((cmd: { input: Record<string, unknown> }) => {
    if ('Media' in cmd.input) return Promise.resolve({}); // StartTranscriptionJob
    return Promise.resolve({
      TranscriptionJob: {
        TranscriptionJobStatus: 'COMPLETED',
        Transcript: { TranscriptFileUri: 'https://transcribe.example/out.json' },
      },
    });
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify({ results: { transcripts: [{ transcript }] } })),
    }),
  );
}

describe('RecitationGrade Lambda', () => {
  beforeEach(() => {
    mockBedrockSend.mockReset();
    mockS3Send.mockReset();
    mockTranscribeSend.mockReset();
    mockGetSignedUrl.mockReset();
    mockS3Send.mockResolvedValue({});
    mockGetSignedUrl.mockResolvedValue('https://s3.example/presigned-put');
  });

  // --- pure core ---

  describe('normalizeTokens', () => {
    it('lowercases, strips punctuation, collapses whitespace', () => {
      expect(normalizeTokens('In the  day, of the LORD!')).toEqual([
        'in',
        'the',
        'day',
        'of',
        'the',
        'lord',
      ]);
    });
    it('handles empty', () => {
      expect(normalizeTokens('   ')).toEqual([]);
    });
  });

  describe('scoreDiff', () => {
    it('is 100% with no missed words for an exact match (punctuation/case ignored)', () => {
      const d = scoreDiff('For God so loved the world', 'for god so loved the world!');
      expect(d.accuracyPct).toBe(100);
      expect(d.missedWords).toEqual([]);
    });
    it('reflects dropped and added words', () => {
      // scoreDiff(transcript, chunkText): transcript added "so"/"whole" not in the chunk.
      const d = scoreDiff('God so loved the whole world', 'God loved the world');
      expect(d.accuracyPct).toBeLessThan(100);
      expect(d.addedWords).toContain('so');
      expect(d.addedWords).toContain('whole');
    });
    it('flags missed words when the recitation drops them', () => {
      // transcript "a c" dropped "b" and "d" from the chunk "a b c d".
      const d = scoreDiff('a c', 'a b c d');
      expect(d.missedWords).toContain('b');
      expect(d.missedWords).toContain('d');
    });
  });

  describe('accuracyToGrade', () => {
    it('maps monotonically across the boundaries', () => {
      expect(accuracyToGrade(100)).toBe('easy');
      expect(accuracyToGrade(95)).toBe('easy');
      expect(accuracyToGrade(90)).toBe('good');
      expect(accuracyToGrade(85)).toBe('good');
      expect(accuracyToGrade(70)).toBe('hard');
      expect(accuracyToGrade(60)).toBe('hard');
      expect(accuracyToGrade(40)).toBe('again');
    });
  });

  describe('buildGradePrompt', () => {
    it('carries transcript + chunk + reference and forbids quoting the passage back', () => {
      const p = buildGradePrompt('what I said', 'the correct text', '2:5');
      expect(p).toContain('what I said');
      expect(p).toContain('the correct text');
      expect(p).toContain('2:5');
      expect(p.toLowerCase()).toContain('never quote');
    });
  });

  describe('parseGrade', () => {
    it('parses strict JSON, tolerating a code fence', () => {
      expect(parseGrade('```json\n{"grade":"good","reason":"minor slip"}\n```')).toEqual({
        grade: 'good',
        reason: 'minor slip',
      });
    });
    it('returns null on an out-of-set grade or garbage', () => {
      expect(parseGrade('{"grade":"perfect"}')).toBeNull();
      expect(parseGrade('not json')).toBeNull();
    });
  });

  // --- handler: presign ---

  describe('presign', () => {
    it('returns a presigned url and an s3Key under the caller prefix', async () => {
      const res = await handler(makeEvent({ action: 'presign', contentType: 'audio/webm' }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.uploadUrl).toBe('https://s3.example/presigned-put');
      expect(body.s3Key).toMatch(new RegExp(`^recitations/${USER}/`));
    });
    it('rejects a non-audio contentType', async () => {
      const res = await handler(makeEvent({ action: 'presign', contentType: 'text/plain' }));
      expect(res.statusCode).toBe(400);
    });
  });

  // --- handler: grade ---

  describe('grade', () => {
    it('returns the Bedrock grade + diff and deletes the clip', async () => {
      stubTranscribe('for god so loved the world');
      mockBedrockSend.mockResolvedValueOnce(bedrockGrade('good', 'one small slip'));
      const res = await handler(
        makeEvent({
          action: 'grade',
          s3Key: `recitations/${USER}/abc`,
          chunkText: 'For God so loved the world',
          reference: '3:16',
        }),
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.grade).toBe('good');
      expect(body.reason).toBe('one small slip');
      expect(body.accuracyPct).toBe(100);
      expect(body.transcript).toBe('for god so loved the world');
      expect(body.degraded).toBeUndefined();
      // clip deleted (a DeleteObjectCommand went to S3)
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('rejects a cross-user s3Key without transcribing', async () => {
      const res = await handler(
        makeEvent({
          action: 'grade',
          s3Key: 'recitations/someone-else/abc',
          chunkText: 'text',
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(mockTranscribeSend).not.toHaveBeenCalled();
    });

    it('degrades to the diff grade when Bedrock fails, and still deletes the clip', async () => {
      stubTranscribe('for god so loved the world');
      mockBedrockSend.mockRejectedValueOnce(new Error('bedrock down'));
      const res = await handler(
        makeEvent({
          action: 'grade',
          s3Key: `recitations/${USER}/abc`,
          chunkText: 'For God so loved the world',
        }),
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.degraded).toBe(true);
      expect(body.grade).toBe('easy'); // 100% diff → easy fallback
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('degrades when transcription fails (no throw out of the handler)', async () => {
      mockTranscribeSend.mockImplementation((cmd: { input: Record<string, unknown> }) => {
        if ('Media' in cmd.input) return Promise.resolve({});
        return Promise.resolve({
          TranscriptionJob: { TranscriptionJobStatus: 'FAILED', FailureReason: 'bad audio' },
        });
      });
      const res = await handler(
        makeEvent({
          action: 'grade',
          s3Key: `recitations/${USER}/abc`,
          chunkText: 'For God so loved the world',
        }),
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).degraded).toBe(true);
      expect(mockBedrockSend).not.toHaveBeenCalled();
    });

    it('requires chunkText', async () => {
      const res = await handler(
        makeEvent({ action: 'grade', s3Key: `recitations/${USER}/abc`, chunkText: '  ' }),
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- validation ---

  it('rejects a missing auth, missing body, and unknown action', async () => {
    expect((await handler(makeEvent({ action: 'presign' }, null))).statusCode).toBe(400);
    expect((await handler(makeEvent(null))).statusCode).toBe(400);
    expect((await handler(makeEvent({ action: 'nope' }))).statusCode).toBe(400);
  });
});
