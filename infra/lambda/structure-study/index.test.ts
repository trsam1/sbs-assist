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

vi.stubEnv('STRUCTURE_STUDIES_TABLE_NAME', 'StructureStudies');
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makeGetEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies/{scrollStudyId}/structure',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makePutEvent(body: string | null, userId: UserId = 'user-1', scrollStudyId = 's1') {
  return {
    httpMethod: 'PUT',
    resource: '/scroll-studies/{scrollStudyId}/structure',
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

const marker = { kind: 'transition', phrase: 'now concerning', ref: '7:1', notes: '' };
const section = { label: 'Opening', startRef: '1:1', endRef: '1:3', notes: '' };
const element = { element: 'greeting', sectionRefs: ['Opening'] };

describe('Structure Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- GET ---

  describe('GET /scroll-studies/{scrollStudyId}/structure', () => {
    it('returns 200 with the stored record', async () => {
      const record = {
        PK: 'USER#u1',
        SK: 'STRUCTURE#s1',
        scrollStudyId: 's1',
        userId: 'u1',
        genre: 'letter',
        tone: 'urgent',
        markers: [marker],
        sections: [section],
        elements: [element],
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

  describe('PUT /scroll-studies/{scrollStudyId}/structure', () => {
    it('upserts and returns 200, keying under the user and scroll', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // read-before-write: none yet
      mockSend.mockResolvedValueOnce({}); // put

      const res = await handler(
        makePutEvent(
          JSON.stringify({
            genre: 'letter',
            tone: 'urgent',
            markers: [marker],
            sections: [section],
            elements: [element],
          }),
        ),
      );
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['PK']).toBe('USER#user-1');
      expect(item['SK']).toBe('STRUCTURE#s1');
      expect(item['scrollStudyId']).toBe('s1');
      expect(item['userId']).toBe('user-1');
      expect(item['genre']).toBe('letter');
      expect(item['markers']).toEqual([marker]);
      expect(item['sections']).toEqual([section]);
      expect(item['elements']).toEqual([element]);
      expect(item['createdAt']).toBe(item['updatedAt']); // first save
      // the response echoes the saved record
      expect(JSON.parse(res.body).scrollStudyId).toBe('s1');
    });

    it('defaults every optional field (empty body object → stored defaults)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({})));
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['genre']).toBe('');
      expect(item['tone']).toBe('');
      expect(item['markers']).toEqual([]);
      expect(item['sections']).toEqual([]);
      expect(item['elements']).toEqual([]);
    });

    it('ignores a userId supplied in the body (taken only from the claim)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(JSON.stringify({ userId: 'attacker', genre: 'poetry' })),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['userId']).toBe('user-1');
    });

    it('preserves createdAt and advances updatedAt across two sequential PUTs', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ genre: 'letter' })));
      const first = putItem(1);
      const firstCreatedAt = first['createdAt'] as string;

      mockSend.mockReset();
      await new Promise((r) => setTimeout(r, 2));
      mockSend.mockResolvedValueOnce({ Item: first });
      mockSend.mockResolvedValueOnce({});
      await handler(makePutEvent(JSON.stringify({ genre: 'epistle' })));
      const second = putItem(1);

      expect(second['createdAt']).toBe(firstCreatedAt);
      expect(new Date(second['updatedAt'] as string).getTime()).toBeGreaterThan(
        new Date(firstCreatedAt).getTime(),
      );
    });

    it('preserves section order as sent', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const sections = [
        { label: 'C', startRef: '', endRef: '', notes: '' },
        { label: 'A', startRef: '', endRef: '', notes: '' },
        { label: 'B', startRef: '', endRef: '', notes: '' },
      ];
      await handler(makePutEvent(JSON.stringify({ sections })));
      expect((putItem(1)['sections'] as Array<{ label: string }>).map((s) => s.label)).toEqual([
        'C',
        'A',
        'B',
      ]);
    });

    it('tolerates an element sectionRef that names no section (no error)', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            sections: [section],
            elements: [{ element: 'doxology', sectionRefs: ['Nonexistent'] }],
          }),
        ),
      );
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['elements']).toEqual([
        { element: 'doxology', sectionRefs: ['Nonexistent'] },
      ]);
    });

    // --- validation ---

    it('rejects an unknown marker kind with 400 and does not write', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ markers: [{ ...marker, kind: 'bogus' }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/kind/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an empty marker phrase with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ markers: [{ ...marker, phrase: '   ' }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/phrase/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length genre with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ genre: 'a'.repeat(201) })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/genre/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an over-length tone with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ tone: 'a'.repeat(2001) })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/tone/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an empty section label with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ sections: [{ ...section, label: '' }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/label/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects an empty element name with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ elements: [{ element: '', sectionRefs: [] }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/element/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects non-string sectionRefs with 400', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ elements: [{ element: 'x', sectionRefs: [1, 2] }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/sectionRefs/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array markers field with 400', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ markers: 'nope' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/markers must be an array/i);
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
