import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-dynamodb', () => {
  return { DynamoDBClient: class MockDynamoDBClient {} };
});
vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: class MockGetCommand {
      constructor(public input: unknown) {}
    },
    PutCommand: class MockPutCommand {
      constructor(public input: unknown) {}
    },
  };
});

vi.stubEnv('FIGURES_STUDIES_TABLE_NAME', 'FiguresStudies');
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makeGetEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies/{scrollStudyId}/figures',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makePutEvent(body: string | null, userId: UserId = 'user-1', scrollStudyId = 's1') {
  return {
    httpMethod: 'PUT',
    resource: '/scroll-studies/{scrollStudyId}/figures',
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

const metaphorEntry = {
  figureType: 'metaphor',
  otherLabel: '',
  group: 'figure',
  reference: '5:2',
  text: 'a thief in the night',
  interpretation: 'the day comes unexpectedly',
  notes: '',
};

describe('Figures Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('GET /scroll-studies/{scrollStudyId}/figures', () => {
    it('returns 200 with the stored record', async () => {
      const record = {
        PK: 'USER#u1',
        SK: 'FIGURES#s1',
        scrollStudyId: 's1',
        userId: 'u1',
        entries: [metaphorEntry],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      mockSend.mockResolvedValueOnce({ Item: record });
      const res = await handler(makeGetEvent('u1', 's1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(record);
    });

    it('returns 404 when none saved yet', async () => {
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makeGetEvent('u1', 's1'));
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 without auth', async () => {
      const res = await handler(makeGetEvent(null, 's1'));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 without a scrollStudyId', async () => {
      const res = await handler(makeGetEvent('u1', null));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /scroll-studies/{scrollStudyId}/figures', () => {
    it('saves entries; first save sets createdAt === updatedAt', async () => {
      mockSend.mockResolvedValueOnce({}); // GET (no existing)
      mockSend.mockResolvedValueOnce({}); // PUT
      const res = await handler(makePutEvent(JSON.stringify({ entries: [metaphorEntry] })));
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['userId']).toBe('user-1');
      expect(item['createdAt']).toBe(item['updatedAt']);
      expect((item['entries'] as unknown[]).length).toBe(1);
    });

    it('preserves createdAt and advances updatedAt on a later save', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { createdAt: '2020-01-01T00:00:00.000Z' },
      }); // GET (existing)
      mockSend.mockResolvedValueOnce({}); // PUT
      const res = await handler(makePutEvent(JSON.stringify({ entries: [metaphorEntry] })));
      expect(res.statusCode).toBe(200);
      const item = putItem(1);
      expect(item['createdAt']).toBe('2020-01-01T00:00:00.000Z');
      expect(item['updatedAt']).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('sets userId from the claim and ignores a body userId', async () => {
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      await handler(
        makePutEvent(JSON.stringify({ userId: 'attacker', entries: [metaphorEntry] }), 'real'),
      );
      expect(putItem(1)['userId']).toBe('real');
    });

    it('recomputes group from a known figureType, overwriting a lying body group', async () => {
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      // antithetic is parallelism; the body lies and says 'figure'
      await handler(
        makePutEvent(
          JSON.stringify({
            entries: [{ ...metaphorEntry, figureType: 'antithetic', group: 'figure' }],
          }),
        ),
      );
      const entries = putItem(1)['entries'] as Array<{ group: string; figureType: string }>;
      expect(entries[0].figureType).toBe('antithetic');
      expect(entries[0].group).toBe('parallelism');
    });

    it('accepts an "other" type with an otherLabel and the body-supplied group', async () => {
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      const res = await handler(
        makePutEvent(
          JSON.stringify({
            entries: [
              {
                ...metaphorEntry,
                figureType: 'other',
                otherLabel: 'chiasm',
                group: 'parallelism',
              },
            ],
          }),
        ),
      );
      expect(res.statusCode).toBe(200);
      const entries = putItem(1)['entries'] as Array<{ otherLabel: string; group: string }>;
      expect(entries[0].otherLabel).toBe('chiasm');
      expect(entries[0].group).toBe('parallelism');
    });

    it('rejects an unknown figureType', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ entries: [{ ...metaphorEntry, figureType: 'bogus' }] })),
      );
      expect(res.statusCode).toBe(400);
    });

    it('rejects an "other" type without an otherLabel', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({ entries: [{ ...metaphorEntry, figureType: 'other', otherLabel: '' }] }),
        ),
      );
      expect(res.statusCode).toBe(400);
    });

    it('rejects a missing reference', async () => {
      const res = await handler(
        makePutEvent(JSON.stringify({ entries: [{ ...metaphorEntry, reference: '' }] })),
      );
      expect(res.statusCode).toBe(400);
    });

    it('rejects an over-long interpretation', async () => {
      const res = await handler(
        makePutEvent(
          JSON.stringify({ entries: [{ ...metaphorEntry, interpretation: 'x'.repeat(2001) }] }),
        ),
      );
      expect(res.statusCode).toBe(400);
    });

    it('rejects malformed JSON', async () => {
      const res = await handler(makePutEvent('{not json'));
      expect(res.statusCode).toBe(400);
    });

    it('treats an absent entries array as empty', async () => {
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      const res = await handler(makePutEvent(JSON.stringify({})));
      expect(res.statusCode).toBe(200);
      expect(putItem(1)['entries']).toEqual([]);
    });

    it('returns 400 without auth', async () => {
      const res = await handler(makePutEvent(JSON.stringify({ entries: [] }), null));
      expect(res.statusCode).toBe(400);
    });
  });
});
