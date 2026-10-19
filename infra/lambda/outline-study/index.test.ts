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

const paragraph = { startRef: '1:1', endRef: '1:2', mainIdea: 'Greeting', notes: 'opens' };
const grouping = { column: 1, startIndex: 0, endIndex: 0, title: 'Opening', notes: '' };

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
        paragraphs: [paragraph],
        groupings: [grouping],
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

      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [paragraph], groupings: [grouping] })),
      );
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['PK']).toBe('USER#user-1');
      expect(item['SK']).toBe('OUTLINE#s1');
      expect(item['scrollStudyId']).toBe('s1');
      expect(item['userId']).toBe('user-1');
      expect(item['paragraphs']).toEqual([paragraph]);
      expect(item['groupings']).toEqual([grouping]);
      expect(item['createdAt']).toBe(item['updatedAt']); // first save
      expect(JSON.parse(res.body).scrollStudyId).toBe('s1');
    });

    it('defaults paragraphs and groupings to [] for an empty body object', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({})));
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['paragraphs']).toEqual([]);
      expect(putItem(1)['groupings']).toEqual([]);
    });

    it('ignores a userId supplied in the body (taken only from the claim)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(JSON.stringify({ userId: 'attacker', paragraphs: [paragraph] })),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['userId']).toBe('user-1');
    });

    it('preserves createdAt and advances updatedAt across two sequential PUTs', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ paragraphs: [paragraph] })));
      const first = putItem(1);
      const firstCreatedAt = first['createdAt'] as string;

      mockSend.mockReset();
      await new Promise((r) => setTimeout(r, 2));
      mockSend.mockResolvedValueOnce({ Item: first });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ paragraphs: [paragraph] })));
      const second = putItem(1);

      expect(second['createdAt']).toBe(firstCreatedAt);
      expect(new Date(second['updatedAt'] as string).getTime()).toBeGreaterThan(
        new Date(firstCreatedAt).getTime(),
      );
    });

    it('preserves paragraph order as sent', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const paragraphs = [
        { startRef: '', endRef: '', mainIdea: 'C', notes: '' },
        { startRef: '', endRef: '', mainIdea: 'A', notes: '' },
        { startRef: '', endRef: '', mainIdea: 'B', notes: '' },
      ];
      await handler(makePutEvent(JSON.stringify({ paragraphs })));
      expect(
        (putItem(1)['paragraphs'] as Array<{ mainIdea: string }>).map((p) => p.mainIdea),
      ).toEqual(['C', 'A', 'B']);
    });

    it('defaults optional ref/notes fields on a paragraph to empty strings', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [{ mainIdea: 'bare' }] })),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['paragraphs']).toEqual([
        { startRef: '', endRef: '', mainIdea: 'bare', notes: '' },
      ]);
    });

    it('defaults optional notes on a grouping to an empty string', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            paragraphs: [paragraph],
            groupings: [{ column: 1, startIndex: 0, endIndex: 0, title: 'g' }],
          }),
        ),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['groupings']).toEqual([
        { column: 1, startIndex: 0, endIndex: 0, title: 'g', notes: '' },
      ]);
    });

    // --- Step 9: theme & purpose ---

    it('accepts and persists theme and purpose', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            paragraphs: [paragraph],
            theme: 'Justification by faith',
            purpose: 'To rebuke the Galatians for a false gospel',
          }),
        ),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['theme']).toBe('Justification by faith');
      expect(putItem(1)['purpose']).toBe('To rebuke the Galatians for a false gospel');
    });

    it('defaults theme and purpose to empty strings when omitted', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({ paragraphs: [paragraph] })));
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['theme']).toBe('');
      expect(putItem(1)['purpose']).toBe('');
    });

    it('rejects an over-length theme (> 80) with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [paragraph], theme: 'a'.repeat(81) })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/theme/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length purpose (> 500) with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [paragraph], purpose: 'a'.repeat(501) })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/purpose/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-string theme with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [paragraph], theme: 42 })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/theme/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    // --- paragraph validation ---

    it('rejects an empty paragraph mainIdea with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [{ ...paragraph, mainIdea: '   ' }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/mainIdea/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length paragraph mainIdea with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [{ ...paragraph, mainIdea: 'a'.repeat(201) }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/mainIdea/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length paragraph startRef with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [{ ...paragraph, startRef: 'a'.repeat(51) }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/startRef/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects over-length paragraph notes with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [{ ...paragraph, notes: 'a'.repeat(1001) }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/notes/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array paragraphs field with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ paragraphs: 'nope' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/paragraphs must be an array/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    // --- grouping validation ---

    it('rejects a grouping with column below 1 with 400', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({ paragraphs: [paragraph], groupings: [{ ...grouping, column: 0 }] }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/column/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a grouping with a non-integer column with 400', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({ paragraphs: [paragraph], groupings: [{ ...grouping, column: 1.5 }] }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/column/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a grouping span out of range (endIndex >= paragraphs.length) with 400', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            paragraphs: [paragraph], // length 1 → valid index only 0
            groupings: [{ ...grouping, startIndex: 0, endIndex: 1 }],
          }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/startIndex\/endIndex|span/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an inverted grouping span (endIndex < startIndex) with 400', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            paragraphs: [paragraph, { ...paragraph, mainIdea: 'p1' }],
            groupings: [{ ...grouping, startIndex: 1, endIndex: 0 }],
          }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/startIndex\/endIndex|span/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a grouping with an empty title with 400', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({ paragraphs: [paragraph], groupings: [{ ...grouping, title: '  ' }] }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/title/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length grouping title with 400', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            paragraphs: [paragraph],
            groupings: [{ ...grouping, title: 'a'.repeat(201) }],
          }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/title/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array groupings field with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ paragraphs: [paragraph], groupings: 'nope' })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/groupings must be an array/i);
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
