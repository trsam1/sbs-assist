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

vi.stubEnv('INTERROGATION_STUDIES_TABLE_NAME', 'InterrogationStudies');
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makeGetEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies/{scrollStudyId}/interrogate',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makePutEvent(body: string | null, userId: UserId = 'user-1', scrollStudyId = 's1') {
  return {
    httpMethod: 'PUT',
    resource: '/scroll-studies/{scrollStudyId}/interrogate',
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

function entry(overrides: Record<string, unknown> = {}) {
  return {
    question: 'Why here?',
    category: 'why',
    tags: [],
    passageRef: '2:7',
    answer: 'Because the audience needed comfort.',
    notes: '',
    ...overrides,
  };
}

describe('Interrogation Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- GET ---

  describe('GET /scroll-studies/{scrollStudyId}/interrogate', () => {
    it('returns 200 with the stored record', async () => {
      const record = {
        PK: 'USER#u1',
        SK: 'INTERROGATE#s1',
        scrollStudyId: 's1',
        userId: 'u1',
        entries: [entry()],
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

  describe('PUT /scroll-studies/{scrollStudyId}/interrogate', () => {
    it('upserts and returns 200, keying under the user and scroll', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // read-before-write: none yet
      mockSend.mockResolvedValueOnce({}); // put

      const res = await handler(makePutEvent(JSON.stringify({ entries: [entry()] })));
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['PK']).toBe('USER#user-1');
      expect(item['SK']).toBe('INTERROGATE#s1');
      expect(item['scrollStudyId']).toBe('s1');
      expect(item['userId']).toBe('user-1');
      expect(item['entries']).toEqual([entry()]);
      expect(item['createdAt']).toBe(item['updatedAt']); // first save
      expect(JSON.parse(res.body).scrollStudyId).toBe('s1');
    });

    it('defaults entries to [] when the body is an empty object', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({})));
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['entries']).toEqual([]);
    });

    it('ignores a userId supplied in the body (taken only from the claim)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(JSON.stringify({ userId: 'attacker', entries: [entry()] })),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['userId']).toBe('user-1');
    });

    it('preserves createdAt and advances updatedAt across two sequential PUTs', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ entries: [entry()] })));
      const first = putItem(1);
      const firstCreatedAt = first['createdAt'] as string;

      mockSend.mockReset();
      await new Promise((r) => setTimeout(r, 2));
      mockSend.mockResolvedValueOnce({ Item: first });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ entries: [entry()] })));
      const second = putItem(1);

      expect(second['createdAt']).toBe(firstCreatedAt);
      expect(new Date(second['updatedAt'] as string).getTime()).toBeGreaterThan(
        new Date(firstCreatedAt).getTime(),
      );
    });

    it('preserves entry order as sent', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const entries = [
        entry({ question: 'C' }),
        entry({ question: 'A' }),
        entry({ question: 'B' }),
      ];
      await handler(makePutEvent(JSON.stringify({ entries })));
      expect((putItem(1)['entries'] as Array<{ question: string }>).map((e) => e.question)).toEqual(
        ['C', 'A', 'B'],
      );
    });

    // --- tags normalization ---

    it('normalizes tags: trim, lower-case, de-dupe, drop blanks, order preserved', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            entries: [
              entry({ tags: ['  About-God ', 'command', 'about-god', '', '  ', 'Context'] }),
            ],
          }),
        ),
      );
      expect(res.statusCode).toBe(200);
      const saved = putItem(1)['entries'] as Array<{ tags: string[] }>;
      expect(saved[0].tags).toEqual(['about-god', 'command', 'context']);
    });

    it('stores an empty tags array when tags is absent', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const e = entry();
      delete (e as Record<string, unknown>)['tags'];
      await handler(makePutEvent(JSON.stringify({ entries: [e] })));
      expect((putItem(1)['entries'] as Array<{ tags: string[] }>)[0].tags).toEqual([]);
    });

    // --- validation ---

    it('rejects a blank question with 400 and does not write', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ entries: [entry({ question: '   ' })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/question/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a category outside the fixed set with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ entries: [entry({ category: 'bogus' })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/category/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('accepts every valid category', async () => {
      for (const category of ['who', 'what', 'when', 'where', 'why', 'how', 'other']) {
        mockSend.mockReset();
        mockSend.mockResolvedValueOnce({ Item: undefined });
        mockSend.mockResolvedValueOnce({});
        const res = await handler(makePutEvent(JSON.stringify({ entries: [entry({ category })] })));
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects an over-length question/passageRef/answer/notes with 400', async () => {
      for (const field of [
        { question: 'a'.repeat(501) },
        { passageRef: 'a'.repeat(51) },
        { answer: 'a'.repeat(4001) },
        { notes: 'a'.repeat(1001) },
      ]) {
        mockSend.mockReset();
        const res = await handler(makePutEvent(JSON.stringify({ entries: [entry(field)] })));
        expect(res.statusCode).toBe(400);
        expect(mockSend).not.toHaveBeenCalled();
      }
    });

    it('rejects an over-length single tag with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ entries: [entry({ tags: ['a'.repeat(41)] })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/tag/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-cap tag array (>20 distinct tags) with 400', async () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      const res = await handler(makePutEvent(JSON.stringify({ entries: [entry({ tags })] })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/at most 20 tags/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array tags field with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ entries: [entry({ tags: 'about-God' })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/tags must be an array/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-string tag element with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ entries: [entry({ tags: ['ok', 7] })] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/tags must be an array of strings/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array entries field with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ entries: 'nope' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/entries must be an array/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-object entry with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ entries: ['nope'] })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/entry must be an object/i);
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
