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
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

/** Cognito authorizer claims as API Gateway delivers them; no claims when userId is null. */
function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makePostEvent(body: string | null, userId: UserId = 'user-1') {
  return {
    httpMethod: 'POST',
    resource: '/studies',
    body,
    headers: {},
    pathParameters: null,
    requestContext: authContext(userId),
  };
}

function makeGetStudyEvent(userId: UserId, studyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/studies/{studyId}',
    headers: {},
    pathParameters: studyId ? { studyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makeListEvent(userId: UserId) {
  return {
    httpMethod: 'GET',
    resource: '/studies',
    headers: {},
    pathParameters: null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makeDeleteEvent(userId: UserId, studyId: string | null) {
  return {
    httpMethod: 'DELETE',
    resource: '/studies/{studyId}',
    headers: {},
    pathParameters: studyId ? { studyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    wordStudies: [],
    ...overrides,
  });
}

function makeWordStudy(englishDefinition: unknown) {
  return {
    word: 'love',
    strongsNumber: 'G25',
    englishDefinition,
    strongsDefinition: 'to love',
    originalWord: 'ἀγαπάω',
    transliteration: 'agapao',
    lexiconEntry: 'From agape',
    crossReferences: [],
    aiSummary: '',
    notes: '',
    definitionNotes: '',
    strongsNotes: '',
    lexiconNotes: '',
  };
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

    it('POST /studies without auth claims returns 400', async () => {
      const res = await handler(makePostEvent(validBody(), null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/authentication/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /studies ignores body.userId; PK uses claims.sub', async () => {
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePostEvent(validBody({ userId: 'attacker' }), 'u1'));
      expect(res.statusCode).toBe(200);
      const item = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['PK']).toBe('USER#u1');
      expect(item['GSI1PK']).toBe('USER#u1');
      expect(item['userId']).toBe('u1');
    });

    it('POST /studies with missing wordStudies returns 400', async () => {
      const res = await handler(makePostEvent(JSON.stringify({ id: 's1' })));
      expect(res.statusCode).toBe(400);
    });

    it('GET /studies/{studyId} without auth claims returns 400', async () => {
      const res = await handler(makeGetStudyEvent(null, 'study-1'));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/authentication/i);
    });

    it('GET /studies/{studyId} with missing studyId returns 400', async () => {
      const res = await handler(makeGetStudyEvent('user-1', null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/studyId/i);
    });

    it('GET /studies without auth claims returns 400', async () => {
      const res = await handler(makeListEvent(null));
      expect(res.statusCode).toBe(400);
    });

    it('DELETE /studies/{studyId} without auth claims returns 400', async () => {
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
      expect((item['createdAt'] as string) >= before).toBe(true);
      expect((item['createdAt'] as string) <= after).toBe(true);
    });

    it('sends correct PutCommand with PK, SK, GSI1PK, GSI1SK fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await handler(makePostEvent(validBody(), 'abc'));

      const putInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      const item = putInput['Item'] as Record<string, unknown>;
      expect(item['PK']).toBe('USER#abc');
      expect(item['SK']).toBe('STUDY#test-uuid-1234');
      expect(item['GSI1PK']).toBe('USER#abc');
      expect((item['GSI1SK'] as string).startsWith('UPDATED#')).toBe(true);
    });
  });

  // --- bookStudyIds (a word study can be linked to several books) ---

  describe('POST /studies bookStudyIds', () => {
    function putItem(callIndex = 0): Record<string, unknown> {
      const putInput = mockSend.mock.calls[callIndex][0].input as Record<string, unknown>;
      return putInput['Item'] as Record<string, unknown>;
    }

    it('stores the ids of every linked book', async () => {
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePostEvent(validBody({ bookStudyIds: ['b-1', 'b-2'] })));
      expect(res.statusCode).toBe(200);
      expect(putItem()['bookStudyIds']).toEqual(['b-1', 'b-2']);
    });

    it('stores a duplicated id once', async () => {
      mockSend.mockResolvedValueOnce({});
      await handler(makePostEvent(validBody({ bookStudyIds: ['b-1', 'b-2', 'b-1'] })));
      expect(putItem()['bookStudyIds']).toEqual(['b-1', 'b-2']);
    });

    it('stores no attribute for a new study that omits the field', async () => {
      mockSend.mockResolvedValueOnce({});
      await handler(makePostEvent(validBody()));
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect('bookStudyIds' in putItem()).toBe(false);
    });

    it('keeps the stored links when an update omits the field', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: { studyId: 'existing-id', bookStudyIds: ['b-1', 'b-2'] } })
        .mockResolvedValueOnce({});
      await handler(makePostEvent(validBody({ id: 'existing-id' })));
      expect(putItem(1)['bookStudyIds']).toEqual(['b-1', 'b-2']);
    });

    it('reads the stored study with the authenticated user key, not one from the body', async () => {
      mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      await handler(makePostEvent(validBody({ id: 'existing-id', userId: 'evil' }), 'user-9'));
      const getInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      expect(getInput['Key']).toEqual({ PK: 'USER#user-9', SK: 'STUDY#existing-id' });
    });

    it('removes the links when an update sends an empty list', async () => {
      mockSend.mockResolvedValueOnce({});
      await handler(makePostEvent(validBody({ id: 'existing-id', bookStudyIds: [] })));
      // An explicit empty list is an answer, so nothing needs reading first.
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect('bookStudyIds' in putItem()).toBe(false);
    });

    it.each([
      ['not an array', 'b-1'],
      ['a non-string entry', ['b-1', 7]],
      ['an empty id', ['']],
      ['an id over 64 characters', ['a'.repeat(65)]],
      ['an id with a space', ['b 1']],
      ['an id with a slash', ['b/1']],
      ['more than 66 distinct ids', Array.from({ length: 67 }, (_, i) => `b-${i}`)],
      ['null', null],
    ])('rejects %s with 400 and does not write', async (_label, value) => {
      const res = await handler(makePostEvent(validBody({ bookStudyIds: value })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toContain('bookStudyIds');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('accepts exactly 66 ids and a 64-character id', async () => {
      mockSend.mockResolvedValueOnce({});
      const ids = Array.from({ length: 65 }, (_, i) => `b-${i}`).concat(['a'.repeat(64)]);
      const res = await handler(makePostEvent(validBody({ bookStudyIds: ids })));
      expect(res.statusCode).toBe(200);
      expect((putItem()['bookStudyIds'] as string[]).length).toBe(66);
    });
  });

  describe('reading bookStudyIds', () => {
    it('GET /studies/{id} returns the links', async () => {
      mockSend.mockResolvedValueOnce({ Item: { studyId: 's1', bookStudyIds: ['b-1', 'b-2'] } });
      const res = await handler(makeGetStudyEvent('user-1', 's1'));
      expect(JSON.parse(res.body).bookStudyIds).toEqual(['b-1', 'b-2']);
    });

    it('GET /studies lists studies with and without links', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ studyId: 's1', bookStudyIds: ['b-1'] }, { studyId: 's2' }],
      });
      const res = await handler(makeListEvent('user-1'));
      const items = JSON.parse(res.body);
      expect(items[0].bookStudyIds).toEqual(['b-1']);
      expect('bookStudyIds' in items[1]).toBe(false);
    });
  });

  // --- GET /studies/{studyId} ---

  describe('GET /studies/{studyId}', () => {
    it('returns 200 with study data when found', async () => {
      const study = { studyId: 's1', userId: 'u1', wordStudies: [] };
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

    it('echoes an allowed request Origin and falls back for an unknown one', async () => {
      const allowed = await handler({
        ...makeListEvent(null),
        headers: { origin: 'https://example.cloudfront.net' },
      });
      expect(allowed.headers['Access-Control-Allow-Origin']).toBe('https://example.cloudfront.net');
      const unknown = await handler({
        ...makeListEvent(null),
        headers: { Origin: 'https://evil.example' },
      });
      expect(unknown.headers['Access-Control-Allow-Origin']).toBe('https://example.cloudfront.net');
    });
  });

  // --- Property-based tests ---

  describe('property-based tests', () => {
    /**
     * Property: For any valid SaveStudyBody, POST /studies returns 200 with a non-empty studyId.
     * Validates: Requirements 6
     */
    it('POST /studies returns 200 with non-empty studyId for any valid body', async () => {
      const validUserId = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
      const validWordStudies = fc.constant([]);

      await fc.assert(
        fc.asyncProperty(validUserId, validWordStudies, async (userId, wordStudies) => {
          mockSend.mockResolvedValueOnce({});

          const body = JSON.stringify({ wordStudies });
          const res = await handler(makePostEvent(body, userId));

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
    it('save then get round-trip preserves wordStudies', async () => {
      const validUserId = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

      await fc.assert(
        fc.asyncProperty(validUserId, async (userId) => {
          const wordStudies = [
            makeWordStudy({
              word: 'love',
              meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'affection' }] }],
            }),
          ];

          // Mock the PutCommand for save
          mockSend.mockResolvedValueOnce({});

          const saveRes = await handler(makePostEvent(JSON.stringify({ wordStudies }), userId));
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

          mockSend.mockReset();
        }),
      );
    });
  });

  // --- Legacy data (englishDefinition stored as a plain string) ---

  describe('legacy englishDefinition', () => {
    it('round-trips a legacy string englishDefinition unchanged', async () => {
      const wordStudies = [makeWordStudy('an intense feeling of deep affection')];
      mockSend.mockResolvedValueOnce({});
      const saveRes = await handler(makePostEvent(JSON.stringify({ wordStudies }), 'u1'));
      expect(saveRes.statusCode).toBe(200);
      const savedItem = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Item'];

      mockSend.mockResolvedValueOnce({ Item: savedItem });
      const getRes = await handler(makeGetStudyEvent('u1', JSON.parse(saveRes.body).studyId));
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.body).wordStudies).toEqual(wordStudies);
    });
  });
});
