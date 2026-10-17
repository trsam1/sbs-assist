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

vi.stubEnv('OUTLINE_STUDIES_TABLE_NAME', 'OutlineStudies');
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makeGetEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies/{scrollStudyId}/outline',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makePutEvent(body: string | null, userId: UserId = 'user-1', scrollStudyId = 's1') {
  return {
    httpMethod: 'PUT',
    resource: '/scroll-studies/{scrollStudyId}/outline',
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

const node = { title: 'Greeting', level: 0, startRef: '1:1', endRef: '1:2', notes: 'opens' };

describe('Outline Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- GET ---

  describe('GET /scroll-studies/{scrollStudyId}/outline', () => {
    it('returns 200 with the stored record', async () => {
      const record = {
        PK: 'USER#u1',
        SK: 'OUTLINE#s1',
        scrollStudyId: 's1',
        userId: 'u1',
        nodes: [node],
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

  describe('PUT /scroll-studies/{scrollStudyId}/outline', () => {
    it('upserts and returns 200, keying under the user and scroll', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // read-before-write: none yet
      mockSend.mockResolvedValueOnce({}); // put

      const res = await handler(makePutEvent(JSON.stringify({ nodes: [node] })));
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['PK']).toBe('USER#user-1');
      expect(item['SK']).toBe('OUTLINE#s1');
      expect(item['scrollStudyId']).toBe('s1');
      expect(item['userId']).toBe('user-1');
      expect(item['nodes']).toEqual([node]);
      expect(item['createdAt']).toBe(item['updatedAt']); // first save
      expect(JSON.parse(res.body).scrollStudyId).toBe('s1');
    });

    it('defaults nodes to [] for an empty body object', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({})));
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['nodes']).toEqual([]);
    });

    it('ignores a userId supplied in the body (taken only from the claim)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(JSON.stringify({ userId: 'attacker', nodes: [node] })),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['userId']).toBe('user-1');
    });

    it('preserves createdAt and advances updatedAt across two sequential PUTs', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ nodes: [node] })));
      const first = putItem(1);
      const firstCreatedAt = first['createdAt'] as string;

      mockSend.mockReset();
      await new Promise((r) => setTimeout(r, 2));
      mockSend.mockResolvedValueOnce({ Item: first });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ nodes: [node] })));
      const second = putItem(1);

      expect(second['createdAt']).toBe(firstCreatedAt);
      expect(new Date(second['updatedAt'] as string).getTime()).toBeGreaterThan(
        new Date(firstCreatedAt).getTime(),
      );
    });

    it('preserves node order as sent', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const nodes = [
        { title: 'C', level: 0, startRef: '', endRef: '', notes: '' },
        { title: 'A', level: 1, startRef: '', endRef: '', notes: '' },
        { title: 'B', level: 0, startRef: '', endRef: '', notes: '' },
      ];
      await handler(makePutEvent(JSON.stringify({ nodes })));
      expect((putItem(1)['nodes'] as Array<{ title: string }>).map((n) => n.title)).toEqual([
        'C',
        'A',
        'B',
      ]);
    });

    it('defaults optional ref/notes fields on a node to empty strings', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(JSON.stringify({ nodes: [{ title: 'bare', level: 2 }] })),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['nodes']).toEqual([
        { title: 'bare', level: 2, startRef: '', endRef: '', notes: '' },
      ]);
    });

    // --- validation ---

    it('rejects an empty node title with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ nodes: [{ ...node, title: '   ' }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/title/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length node title with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ nodes: [{ ...node, title: 'a'.repeat(201) }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/title/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-integer level with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ nodes: [{ ...node, level: 1.5 }] })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/level/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a level below 0 with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ nodes: [{ ...node, level: -1 }] })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/level/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a level above 3 with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ nodes: [{ ...node, level: 4 }] })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/level/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a missing level with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ nodes: [{ title: 'x' }] })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/level/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length startRef with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ nodes: [{ ...node, startRef: 'a'.repeat(51) }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/startRef/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects over-length notes with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ nodes: [{ ...node, notes: 'a'.repeat(1001) }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/notes/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array nodes field with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ nodes: 'nope' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/nodes must be an array/i);
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
