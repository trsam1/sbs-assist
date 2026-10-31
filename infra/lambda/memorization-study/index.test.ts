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

vi.stubEnv('MEMORIZATION_STUDIES_TABLE_NAME', 'MemorizationStudies');
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makeGetEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies/{scrollStudyId}/memorize',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makePutEvent(body: string | null, userId: UserId = 'user-1', scrollStudyId = 's1') {
  return {
    httpMethod: 'PUT',
    resource: '/scroll-studies/{scrollStudyId}/memorize',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body,
    requestContext: authContext(userId),
  };
}

function putItem(callIndex: number): Record<string, unknown> {
  return (mockSend.mock.calls[callIndex][0].input as Record<string, unknown>)['Item'] as Record<
    string,
    unknown
  >;
}

function chunk(overrides: Record<string, unknown> = {}) {
  return { start: 0, end: 20, verseRef: '2:7', state: 'new', ...overrides };
}

describe('Memorization Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- GET ---

  describe('GET /scroll-studies/{scrollStudyId}/memorize', () => {
    it('returns 200 with the stored record', async () => {
      const record = {
        PK: 'USER#u1',
        SK: 'MEMORIZE#s1',
        scrollStudyId: 's1',
        userId: 'u1',
        chunks: [chunk()],
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

  describe('PUT /scroll-studies/{scrollStudyId}/memorize', () => {
    it('upserts and returns 200, keying under the user and scroll', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // read-before-write
      mockSend.mockResolvedValueOnce({}); // put

      const res = await handler(makePutEvent(JSON.stringify({ chunks: [chunk()] })));
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['PK']).toBe('USER#user-1');
      expect(item['SK']).toBe('MEMORIZE#s1');
      expect(item['scrollStudyId']).toBe('s1');
      expect(item['userId']).toBe('user-1');
      expect(item['chunks']).toEqual([chunk()]);
      expect(item['createdAt']).toBe(item['updatedAt']); // first save
    });

    it('defaults chunks to [] when the body is an empty object', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({})));
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['chunks']).toEqual([]);
    });

    it('ignores a userId supplied in the body (taken only from the claim)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(JSON.stringify({ userId: 'attacker', chunks: [chunk()] })),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['userId']).toBe('user-1');
    });

    it('preserves createdAt and advances updatedAt across two sequential PUTs', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ chunks: [chunk()] })));
      const first = putItem(1);
      const firstCreatedAt = first['createdAt'] as string;

      mockSend.mockReset();
      await new Promise((r) => setTimeout(r, 2));
      mockSend.mockResolvedValueOnce({ Item: first });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ chunks: [chunk()] })));
      const second = putItem(1);

      expect(second['createdAt']).toBe(firstCreatedAt);
      expect(new Date(second['updatedAt'] as string).getTime()).toBeGreaterThan(
        new Date(firstCreatedAt).getTime(),
      );
    });

    it('preserves chunk order as sent', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const chunks = [
        chunk({ start: 40, end: 60, verseRef: '3' }),
        chunk({ start: 0, end: 20, verseRef: '1' }),
        chunk({ start: 20, end: 40, verseRef: '2' }),
      ];
      await handler(makePutEvent(JSON.stringify({ chunks })));
      expect((putItem(1)['chunks'] as Array<{ verseRef: string }>).map((c) => c.verseRef)).toEqual([
        '3',
        '1',
        '2',
      ]);
    });

    it('stores only offsets/label/state — no verse text leaks into the item', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ chunks: [chunk()] })));
      const saved = (putItem(1)['chunks'] as Array<Record<string, unknown>>)[0];
      expect(Object.keys(saved).sort()).toEqual(['end', 'start', 'state', 'verseRef']);
    });

    it('does NOT read the ScrollStudies table (only its own key space, twice: read+put)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ chunks: [chunk()] })));
      // Exactly two DynamoDB ops (read-before-write + put), both in this tool's own key space.
      expect(mockSend).toHaveBeenCalledTimes(2);
      for (const call of mockSend.mock.calls) {
        const input = call[0].input as {
          Key?: { SK?: string };
          Item?: { SK?: string };
        };
        const sk = input.Key?.SK ?? input.Item?.SK;
        expect(sk).toMatch(/^MEMORIZE#/);
        expect(sk).not.toMatch(/^SCROLL#/);
      }
    });

    it('accepts every valid state', async () => {
      for (const state of ['new', 'learning', 'chained', 'solid']) {
        mockSend.mockReset();
        mockSend.mockResolvedValueOnce({ Item: undefined });
        mockSend.mockResolvedValueOnce({});
        const res = await handler(makePutEvent(JSON.stringify({ chunks: [chunk({ state })] })));
        expect(res.statusCode).toBe(200);
      }
    });

    // --- validation ---

    it('rejects start >= end with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ chunks: [chunk({ start: 20, end: 20 })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/start must be less than/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a negative offset with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ chunks: [chunk({ start: -1, end: 10 })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/non-negative integers/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-integer offset with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ chunks: [chunk({ start: 0, end: 10.5 })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length verseRef with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ chunks: [chunk({ verseRef: 'a'.repeat(51) })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/verseRef/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a state outside the fixed set with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ chunks: [chunk({ state: 'mastered' })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/state/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-cap chunk array (>2000) with 400', async () => {
      const chunks = Array.from({ length: 2001 }, (_, i) => chunk({ start: i, end: i + 1 }));
      const res = await handler(makePutEvent(JSON.stringify({ chunks })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/at most 2000 chunks/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array chunks field with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ chunks: 'nope' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/chunks must be an array/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-object chunk with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ chunks: ['nope'] })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/chunk must be an object/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON with 400', async () => {
      const res = await handler(makePutEvent('{not json'));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/json/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a null/missing body with 400', async () => {
      const res = await handler(makePutEvent(null));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns 400 without auth claims', async () => {
      const res = await handler(makePutEvent(JSON.stringify({}), null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/authentication/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns 400 with a missing scrollStudyId path param', async () => {
      const res = await handler(makePutEvent(JSON.stringify({}), 'u1', ''));
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
