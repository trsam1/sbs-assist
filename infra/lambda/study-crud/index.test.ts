import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock the DynamoDB client before importing the handler
const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: class MockDynamoDBClient {},
  };
});
vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({ send: mockSend }),
    },
    GetCommand: class MockGetCommand {
      constructor(public input: unknown) {}
    },
    PutCommand: class MockPutCommand {
      constructor(public input: unknown) {}
    },
    QueryCommand: class MockQueryCommand {
      constructor(public input: unknown) {}
    },
    DeleteCommand: class MockDeleteCommand {
      constructor(public input: unknown) {}
    },
  };
});

vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

// Set env vars before importing handler
vi.stubEnv('WORD_STUDIES_TABLE_NAME', 'WordStudies');
vi.stubEnv('ALLOWED_ORIGIN', 'https://example.cloudfront.net');

import { handler } from './index';

function makePostEvent(body: string | null) {
  return {
    httpMethod: 'POST',
    resource: '/studies',
    body,
    headers: {},
    pathParameters: null,
  };
}

function makeGetStudyEvent(userId: string | null, studyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/studies/{studyId}',
    headers: userId ? { 'x-user-id': userId } : {},
    pathParameters: studyId ? { studyId } : null,
    body: null,
  };
}

function makeListEvent(userId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/studies',
    headers: userId ? { 'x-user-id': userId } : {},
    pathParameters: null,
    body: null,
  };
}

function makeDeleteEvent(userId: string | null, studyId: string | null) {
  return {
    httpMethod: 'DELETE',
    resource: '/studies/{studyId}',
    headers: userId ? { 'x-user-id': userId } : {},
    pathParameters: studyId ? { studyId } : null,
    body: null,
  };
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    userId: 'user-1',
    wordStudies: [],
    status: 'in_progress',
    ...overrides,
  });
}

describe('Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- Input validation / 400 responses ---

  describe('input validation', () => {
    it('POST /studies with null body returns 400', async () => {
      const res = await handler(makePostEvent(null));
      expect(res.statusCode).toBe(400);
    });

    it('POST /studies with invalid JSON returns 400', async () => {
      const res = await handler(makePostEvent('not json'));
      expect(res.statusCode).toBe(400);
    });

    it('POST /studies with missing userId returns 400', async () => {
      const res = await handler(makePostEvent(JSON.stringify({ wordStudies: [], status: 'in_progress' })));
      expect(res.statusCode).toBe(400);
    });

    it('POST /studies with missing wordStudies returns 400', async () => {
      const res = await handler(makePostEvent(JSON.stringify({ userId: 'u1', status: 'in_progress' })));
      expect(res.statusCode).toBe(400);
    });

    it('POST /studies with invalid status returns 400', async () => {
      const res = await handler(makePostEvent(JSON.stringify({ userId: 'u1', wordStudies: [], status: 'draft' })));
      expect(res.statusCode).toBe(400);
    });

    it('GET /studies/{studyId} with missing X-User-Id returns 400', async () => {
      const res = await handler(makeGetStudyEvent(null, 'study-1'));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/X-User-Id/i);
    });

    it('GET /studies/{studyId} with missing studyId returns 400', async () => {
      const res = await handler(makeGetStudyEvent('user-1', null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/studyId/i);
    });

    it('GET /studies with missing X-User-Id returns 400', async () => {
      const res = await handler(makeListEvent(null));
      expect(res.statusCode).toBe(400);
    });

    it('DELETE /studies/{studyId} with missing X-User-Id returns 400', async () => {
      const res = await handler(makeDeleteEvent(null, 'study-1'));
      expect(res.statusCode).toBe(400);
    });

    it('DELETE /studies/{studyId} with missing studyId returns 400', async () => {
      const res = await handler(makeDeleteEvent('user-1', null));
      expect(res.statusCode).toBe(400);
    });
  });

  // --- POST /studies — saveWordStudy ---

  describe('POST /studies', () => {
    it('saves a new study and returns 200 with studyId', async () => {
      mockSend.mockResolvedValueOnce({});

      const res = await handler(makePostEvent(validBody()));
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.studyId).toBe('test-uuid-1234');
    });

    it('saves with existing id and returns that id', async () => {
      mockSend.mockResolvedValueOnce({});

      const res = await handler(makePostEvent(validBody({ id: 'existing-id' })));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).studyId).toBe('existing-id');
    });

    it('preserves createdAt when provided in body', async () => {
      mockSend.mockResolvedValueOnce({});

      await handler(makePostEvent(validBody({ createdAt: '2024-01-01T00:00:00.000Z' })));

      const putInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      const item = putInput['Item'] as Record<string, unknown>;
      expect(item['createdAt']).toBe('2024-01-01T00:00:00.000Z');
    });

    it('sets createdAt to current time when not provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const before = new Date().toISOString();
      await handler(makePostEvent(validBody()));
      const after = new Date().toISOString();

      const putInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      const item = putInput['Item'] as Record<string, unknown>;
      expect(item['createdAt'] as string >= before).toBe(true);
      expect(item['createdAt'] as string <= after).toBe(true);
    });

    it('sends correct PutCommand with PK, SK, GSI1PK, GSI1SK fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await handler(makePostEvent(validBody({ userId: 'abc' })));

      const putInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      const item = putInput['Item'] as Record<string, unknown>;
      expect(item['PK']).toBe('USER#abc');
      expect(item['SK']).toBe('STUDY#test-uuid-1234');
      expect(item['GSI1PK']).toBe('USER#abc');
      expect((item['GSI1SK'] as string).startsWith('UPDATED#')).toBe(true);
    });
  });

  // --- GET /studies/{studyId} ---

  describe('GET /studies/{studyId}', () => {
    it('returns 200 with study data when found', async () => {
      const study = { studyId: 's1', userId: 'u1', wordStudies: [], status: 'in_progress' };
      mockSend.mockResolvedValueOnce({ Item: study });

      const res = await handler(makeGetStudyEvent('u1', 's1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(study);
    });

    it('returns 404 when study not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const res = await handler(makeGetStudyEvent('u1', 'nonexistent'));
      expect(res.statusCode).toBe(404);
    });
  });

  // --- GET /studies ---

  describe('GET /studies', () => {
    it('returns 200 with array of studies', async () => {
      const studies = [
        { studyId: 's1', userId: 'u1' },
        { studyId: 's2', userId: 'u1' },
      ];
      mockSend.mockResolvedValueOnce({ Items: studies });

      const res = await handler(makeListEvent('u1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(studies);
    });

    it('returns 200 with empty array when no studies exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const res = await handler(makeListEvent('u1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('queries GSI1 with ScanIndexForward: false', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await handler(makeListEvent('u1'));

      const queryInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      expect(queryInput['IndexName']).toBe('GSI1');
      expect(queryInput['ScanIndexForward']).toBe(false);
    });
  });

  // --- DELETE /studies/{studyId} ---

  describe('DELETE /studies/{studyId}', () => {
    it('returns 200 when study exists and is deleted', async () => {
      // First call: getStudy (GetCommand) returns existing item
      mockSend.mockResolvedValueOnce({ Item: { studyId: 's1' } });
      // Second call: DeleteCommand succeeds
      mockSend.mockResolvedValueOnce({});

      const res = await handler(makeDeleteEvent('u1', 's1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).message).toMatch(/deleted/i);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('returns 404 when study does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const res = await handler(makeDeleteEvent('u1', 'nonexistent'));
      expect(res.statusCode).toBe(404);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  // --- Unknown routes ---

  describe('unknown routes', () => {
    it('returns 404 for unmatched routes', async () => {
      const res = await handler({
        httpMethod: 'PATCH',
        resource: '/unknown',
        headers: {},
        pathParameters: null,
        body: null,
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).message).toBe('Not found');
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('returns 500 with error message when DynamoDB throws an Error', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));

      const res = await handler(makePostEvent(validBody()));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toBe('DynamoDB timeout');
    });

    it('returns 500 with generic message when non-Error is thrown', async () => {
      mockSend.mockRejectedValueOnce('something weird');

      const res = await handler(makePostEvent(validBody()));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toBe('Internal server error');
    });
  });

  // --- CORS headers ---

  describe('CORS headers', () => {
    it('includes CORS headers on success responses', async () => {
      mockSend.mockResolvedValueOnce({});

      const res = await handler(makePostEvent(validBody()));
      expect(res.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Methods');
    });

    it('includes CORS headers on error responses', async () => {
      const res = await handler(makePostEvent(null));
      expect(res.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });

  // --- Property-based tests ---

  describe('property-based tests', () => {
    /**
     * Property: For any valid SaveStudyBody, POST /studies returns 200 with a non-empty studyId.
     * Validates: Requirements 6
     */
    it('POST /studies returns 200 with non-empty studyId for any valid body', async () => {
      const validStatus = fc.oneof(
        fc.constant('in_progress' as const),
        fc.constant('completed' as const),
      );
      const validUserId = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
      const validWordStudies = fc.constant([]);

      await fc.assert(
        fc.asyncProperty(validUserId, validWordStudies, validStatus, async (userId, wordStudies, status) => {
          mockSend.mockResolvedValueOnce({});

          const body = JSON.stringify({ userId, wordStudies, status });
          const res = await handler(makePostEvent(body));

          expect(res.statusCode).toBe(200);
          const parsed = JSON.parse(res.body);
          expect(typeof parsed.studyId).toBe('string');
          expect(parsed.studyId.length).toBeGreaterThan(0);

          mockSend.mockReset();
        }),
      );
    });

    /**
     * Property: For any valid StudyWorksheet saved via POST, a subsequent GET with the
     * same userId and returned studyId retrieves matching wordStudies and status.
     * Validates: Requirements 6
     */
    it('save then get round-trip preserves wordStudies and status', async () => {
      const validStatus = fc.oneof(
        fc.constant('in_progress' as const),
        fc.constant('completed' as const),
      );
      const validUserId = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

      await fc.assert(
        fc.asyncProperty(validUserId, validStatus, async (userId, status) => {
          const wordStudies = [
            {
              word: 'love',
              strongsNumber: 'G25',
              englishDefinition: 'affection',
              strongsDefinition: 'to love',
              originalWord: 'ἀγαπάω',
              transliteration: 'agapao',
              lexiconEntry: 'From agape',
              crossReferences: [],
              aiSummary: '',
              notes: '',
            },
          ];

          // Mock the PutCommand for save
          mockSend.mockResolvedValueOnce({});

          const saveRes = await handler(makePostEvent(JSON.stringify({ userId, wordStudies, status })));
          expect(saveRes.statusCode).toBe(200);
          const { studyId } = JSON.parse(saveRes.body);

          // Capture what was written to DynamoDB
          const putInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
          const savedItem = putInput['Item'] as Record<string, unknown>;

          // Mock the GetCommand to return the saved item
          mockSend.mockResolvedValueOnce({ Item: savedItem });

          const getRes = await handler(makeGetStudyEvent(userId, studyId));
          expect(getRes.statusCode).toBe(200);

          const retrieved = JSON.parse(getRes.body);
          expect(retrieved.wordStudies).toEqual(wordStudies);
          expect(retrieved.status).toBe(status);

          mockSend.mockReset();
        }),
      );
    });
  });
});
