import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  };
});

vi.stubEnv('ANTECEDENT_STUDIES_TABLE_NAME', 'AntecedentStudies');
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makeGetEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies/{scrollStudyId}/antecedents',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makePutEvent(body: string | null, userId: UserId = 'user-1', scrollStudyId = 's1') {
  return {
    httpMethod: 'PUT',
    resource: '/scroll-studies/{scrollStudyId}/antecedents',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body,
    requestContext: authContext(userId),
  };
}

function assignment(overrides: Record<string, unknown> = {}) {
  return { occurrence: 0, start: 0, word: 'he', antecedent: 'Jesus', ...overrides };
}

function putItem(callIndex: number): Record<string, unknown> {
  return (mockSend.mock.calls[callIndex][0].input as Record<string, unknown>)['Item'] as Record<
    string,
    unknown
  >;
}

describe('Antecedent Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- GET ---

  describe('GET /scroll-studies/{scrollStudyId}/antecedents', () => {
    it('returns 200 with the stored record', async () => {
      const record = {
        PK: 'USER#u1',
        SK: 'ANTECEDENT#s1',
        scrollStudyId: 's1',
        userId: 'u1',
        assignments: [assignment()],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      };
      mockSend.mockResolvedValueOnce({ Item: record });

      const res = await handler(makeGetEvent('u1', 's1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(record);
    });

    it('returns 404 when no record exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const res = await handler(makeGetEvent('u1', 's1'));
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 without auth claims', async () => {
      const res = await handler(makeGetEvent(null, 's1'));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/authentication/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns 400 with a missing scrollStudyId path param', async () => {
      const res = await handler(makeGetEvent('u1', null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/scrollStudyId/i);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // --- PUT upsert ---

  describe('PUT /scroll-studies/{scrollStudyId}/antecedents', () => {
    it('upserts and returns 200, keying under the user and scroll', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // read-before-write: none yet
      mockSend.mockResolvedValueOnce({}); // put

      const res = await handler(makePutEvent(JSON.stringify({ assignments: [assignment()] })));
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['PK']).toBe('USER#user-1');
      expect(item['SK']).toBe('ANTECEDENT#s1');
      expect(item['scrollStudyId']).toBe('s1');
      expect(item['userId']).toBe('user-1');
      expect(item['assignments']).toEqual([assignment()]);
      expect(item['createdAt']).toBe(item['updatedAt']); // first save
    });

    it('preserves createdAt and advances updatedAt across two sequential PUTs', async () => {
      // First save: no existing item.
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ assignments: [assignment()] })));
      const first = putItem(1);
      const firstCreatedAt = first['createdAt'] as string;

      // Second save: the read-before-write GetCommand returns the first-save item.
      mockSend.mockReset();
      await new Promise((r) => setTimeout(r, 2)); // ensure a later ISO timestamp
      mockSend.mockResolvedValueOnce({ Item: first });
      mockSend.mockResolvedValueOnce({});
      await handler(
        makePutEvent(JSON.stringify({ assignments: [assignment({ antecedent: 'the Father' })] })),
      );
      const second = putItem(1);

      expect(second['createdAt']).toBe(firstCreatedAt);
      expect(new Date(second['updatedAt'] as string).getTime()).toBeGreaterThan(
        new Date(firstCreatedAt).getTime(),
      );
    });

    it('drops empty and whitespace-only antecedents after trim (not an error)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      const res = await handler(
        makePutEvent(
          JSON.stringify({
            assignments: [
              assignment({ occurrence: 0, antecedent: '  Jesus  ' }),
              assignment({ occurrence: 1, antecedent: '   ' }),
              assignment({ occurrence: 2, antecedent: '' }),
            ],
          }),
        ),
      );
      expect(res.statusCode).toBe(200);
      const stored = putItem(1)['assignments'] as Array<Record<string, unknown>>;
      expect(stored).toHaveLength(1);
      expect(stored[0]['occurrence']).toBe(0);
      expect(stored[0]['antecedent']).toBe('Jesus'); // trimmed
    });

    it('stores assignments: [] for an all-empty worksheet and a later GET returns it (not 404)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      const putRes = await handler(
        makePutEvent(JSON.stringify({ assignments: [assignment({ antecedent: '' })] })),
      );
      expect(putRes.statusCode).toBe(200);
      const stored = putItem(1);
      expect(stored['assignments']).toEqual([]);

      mockSend.mockReset();
      mockSend.mockResolvedValueOnce({ Item: stored });
      const getRes = await handler(makeGetEvent('user-1', 's1'));
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.body).assignments).toEqual([]);
    });

    it('accepts an empty assignments array', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({ assignments: [] })));
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['assignments']).toEqual([]);
    });

    it('rejects an over-length antecedent (>200 after trim) with 400 and does not write', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({ assignments: [assignment({ antecedent: 'a'.repeat(201) })] }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/200 characters/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array body with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ assignments: 'nope' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/array/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a malformed element with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ assignments: ['not-an-object'] })));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a negative occurrence with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ assignments: [assignment({ occurrence: -1 })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/occurrence/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-integer start with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ assignments: [assignment({ start: 1.5 })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/start/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a null/missing body with 400', async () => {
      const res = await handler(makePutEvent(null));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns 400 without auth claims', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ assignments: [] }), null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/authentication/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns 400 with a missing scrollStudyId path param', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ assignments: [] }), 'u1', ''));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/scrollStudyId/i);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // --- unknown routes / error handling ---

  describe('routing and errors', () => {
    it('returns 404 for unmatched routes', async () => {
      const res = await handler({
        httpMethod: 'POST',
        resource: '/unknown',
        headers: {},
        pathParameters: null,
        body: null,
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 500 when DynamoDB throws an Error', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));
      const res = await handler(makeGetEvent('u1', 's1'));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toBe('DynamoDB timeout');
    });
  });

  // --- CORS ---

  describe('CORS headers', () => {
    it('includes CORS headers via the shared helper on success and error', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const notFound = await handler(makeGetEvent('u1', 's1'));
      expect(notFound.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(notFound.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(notFound.headers).toHaveProperty('Access-Control-Allow-Methods');

      const badReq = await handler(makeGetEvent(null, 's1'));
      expect(badReq.headers).toHaveProperty('Access-Control-Allow-Origin');
    });
  });
});
