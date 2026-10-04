import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { BIBLE_BOOKS } from '../shared/bible-books';

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
vi.stubEnv('BOOK_STUDIES_TABLE_NAME', 'BookStudies');
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
    resource: '/books',
    body,
    headers: {},
    pathParameters: null,
    requestContext: authContext(userId),
  };
}

function makeGetBookEvent(userId: UserId, bookStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/books/{bookStudyId}',
    headers: {},
    pathParameters: bookStudyId ? { bookStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makeListEvent(userId: UserId) {
  return {
    httpMethod: 'GET',
    resource: '/books',
    headers: {},
    pathParameters: null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makeDeleteEvent(userId: UserId, bookStudyId: string | null) {
  return {
    httpMethod: 'DELETE',
    resource: '/books/{bookStudyId}',
    headers: {},
    pathParameters: bookStudyId ? { bookStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    book: 'Genesis',
    ...overrides,
  });
}

describe('Book Study CRUD Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- Input validation / 400 responses ---

  describe('input validation', () => {
    it('POST /books with null body returns 400', async () => {
      const res = await handler(makePostEvent(null));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /books with invalid JSON returns 400', async () => {
      const res = await handler(makePostEvent('not json'));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /books without auth claims returns 400', async () => {
      const res = await handler(makePostEvent(validBody(), null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/authentication/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /books with missing book returns 400', async () => {
      const res = await handler(makePostEvent(JSON.stringify({ title: 'x' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/book/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /books with an invalid book name returns 400', async () => {
      const res = await handler(makePostEvent(validBody({ book: 'Gospel of Thomas' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/book/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /books with over-long title returns 400', async () => {
      const res = await handler(makePostEvent(validBody({ title: 'a'.repeat(201) })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/title/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /books with over-long notes returns 400', async () => {
      const res = await handler(makePostEvent(validBody({ notes: 'a'.repeat(2001) })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/notes/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('POST /books ignores body.userId; PK uses claims.sub', async () => {
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

    it('GET /books/{bookStudyId} without auth claims returns 400', async () => {
      const res = await handler(makeGetBookEvent(null, 'book-1'));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/authentication/i);
    });

    it('GET /books/{bookStudyId} with missing id returns 400', async () => {
      const res = await handler(makeGetBookEvent('user-1', null));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/bookStudyId/i);
    });

    it('GET /books without auth claims returns 400', async () => {
      const res = await handler(makeListEvent(null));
      expect(res.statusCode).toBe(400);
    });

    it('DELETE /books/{bookStudyId} without auth claims returns 400', async () => {
      const res = await handler(makeDeleteEvent(null, 'book-1'));
      expect(res.statusCode).toBe(400);
    });

    it('DELETE /books/{bookStudyId} with missing id returns 400', async () => {
      const res = await handler(makeDeleteEvent('user-1', null));
      expect(res.statusCode).toBe(400);
    });
  });

  // --- POST /books ---

  describe('POST /books', () => {
    it('creates a new book study and returns 200 with bookStudyId', async () => {
      mockSend.mockResolvedValueOnce({});

      const res = await handler(makePostEvent(validBody()));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).bookStudyId).toBe('test-uuid-1234');
    });

    it('stores book, title, notes and sets createdAt === updatedAt', async () => {
      mockSend.mockResolvedValueOnce({});

      await handler(
        makePostEvent(
          validBody({ book: 'John', title: 'My John study', notes: 'some notes' }),
          'abc',
        ),
      );

      const item = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['PK']).toBe('USER#abc');
      expect(item['SK']).toBe('BOOKSTUDY#test-uuid-1234');
      expect(item['GSI1PK']).toBe('USER#abc');
      expect((item['GSI1SK'] as string).startsWith('UPDATED#')).toBe(true);
      expect(item['book']).toBe('John');
      expect(item['title']).toBe('My John study');
      expect(item['notes']).toBe('some notes');
      expect(item['createdAt']).toBe(item['updatedAt']);
    });

    it('defaults title and notes to empty strings when omitted', async () => {
      mockSend.mockResolvedValueOnce({});

      await handler(makePostEvent(validBody()));

      const item = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['title']).toBe('');
      expect(item['notes']).toBe('');
    });

    it('defaults referents to an empty array when omitted', async () => {
      mockSend.mockResolvedValueOnce({});

      await handler(makePostEvent(validBody()));

      const item = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['referents']).toEqual([]);
    });

    it('stores a referents array verbatim', async () => {
      mockSend.mockResolvedValueOnce({});

      const referents = [
        { phrase: 'the ruler of this world', refersTo: 'Satan', notes: 'John 12', scrollRef: '' },
        { phrase: 'the Lamb', refersTo: 'Jesus', notes: '', scrollRef: 'ch. 5' },
      ];
      await handler(makePostEvent(validBody({ referents })));

      const item = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['referents']).toEqual(referents);
    });

    it('defaults a referent entry notes/scrollRef to empty strings when omitted', async () => {
      mockSend.mockResolvedValueOnce({});

      await handler(
        makePostEvent(validBody({ referents: [{ phrase: 'the Word', refersTo: 'Jesus' }] })),
      );

      const item = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['referents']).toEqual([
        { phrase: 'the Word', refersTo: 'Jesus', notes: '', scrollRef: '' },
      ]);
    });
  });

  // --- POST /books upsert (id present) ---

  describe('POST /books upsert', () => {
    it('with an id present updates in place, preserving createdAt and advancing updatedAt', async () => {
      const storedCreatedAt = '2020-01-01T00:00:00.000Z';
      // Update path: GetCommand resolves the existing item, then PutCommand resolves.
      mockSend.mockResolvedValueOnce({
        Item: { bookStudyId: 'book-existing', userId: 'u1', createdAt: storedCreatedAt },
      });
      mockSend.mockResolvedValueOnce({});

      const res = await handler(
        makePostEvent(
          // deliberately omit createdAt — the server owns preservation
          validBody({ id: 'book-existing', book: 'John', title: 'edited' }),
          'u1',
        ),
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).bookStudyId).toBe('book-existing');
      // Two sends: the Get (preserve createdAt) then the Put.
      expect(mockSend).toHaveBeenCalledTimes(2);

      const item = (mockSend.mock.calls[1][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['bookStudyId']).toBe('book-existing');
      expect(item['SK']).toBe('BOOKSTUDY#book-existing');
      expect(item['createdAt']).toBe(storedCreatedAt);
      expect(item['updatedAt'] as string).not.toBe(storedCreatedAt);
      expect(new Date(item['updatedAt'] as string).getTime()).toBeGreaterThan(
        new Date(storedCreatedAt).getTime(),
      );
    });

    it('with an id that has no existing item writes a create with createdAt === updatedAt', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // Get finds nothing
      mockSend.mockResolvedValueOnce({}); // Put

      const res = await handler(makePostEvent(validBody({ id: 'book-new' }), 'u1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).bookStudyId).toBe('book-new');

      const item = (mockSend.mock.calls[1][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['createdAt']).toBe(item['updatedAt']);
    });

    it('ignores body.userId on the update path; PK uses claims.sub', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { bookStudyId: 'b-up', userId: 'u1', createdAt: '2021-01-01T00:00:00.000Z' },
      });
      mockSend.mockResolvedValueOnce({});

      const res = await handler(
        makePostEvent(
          validBody({
            id: 'b-up',
            userId: 'attacker',
            referents: [{ phrase: 'p', refersTo: 'r' }],
          }),
          'u1',
        ),
      );
      expect(res.statusCode).toBe(200);

      // The Get is keyed on the caller's own PK.
      const getKey = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Key'] as Record<
        string,
        unknown
      >;
      expect(getKey['PK']).toBe('USER#u1');

      const item = (mockSend.mock.calls[1][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['PK']).toBe('USER#u1');
      expect(item['userId']).toBe('u1');
    });
  });

  // --- POST /books referent validation ---

  describe('POST /books referent validation', () => {
    it('rejects a blank-after-trim phrase with 400 naming referents', async () => {
      const res = await handler(
        makePostEvent(validBody({ referents: [{ phrase: '   ', refersTo: 'Satan' }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/referents/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a blank-after-trim refersTo with 400 naming referents', async () => {
      const res = await handler(
        makePostEvent(validBody({ referents: [{ phrase: 'the Word', refersTo: '  ' }] })),
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/referents/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects a non-array referents with 400 naming referents', async () => {
      const res = await handler(makePostEvent(validBody({ referents: 'nope' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/referents/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('accepts a phrase/refersTo of exactly 200 chars but rejects 201', async () => {
      mockSend.mockResolvedValueOnce({});
      const ok = await handler(
        makePostEvent(
          validBody({ referents: [{ phrase: 'a'.repeat(200), refersTo: 'b'.repeat(200) }] }),
        ),
      );
      expect(ok.statusCode).toBe(200);

      mockSend.mockReset();
      const bad = await handler(
        makePostEvent(validBody({ referents: [{ phrase: 'a'.repeat(201), refersTo: 'ok' }] })),
      );
      expect(bad.statusCode).toBe(400);
      expect(JSON.parse(bad.body).message).toMatch(/referents/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('accepts notes/scrollRef of exactly 1000 chars but rejects 1001', async () => {
      mockSend.mockResolvedValueOnce({});
      const ok = await handler(
        makePostEvent(
          validBody({
            referents: [
              { phrase: 'p', refersTo: 'r', notes: 'n'.repeat(1000), scrollRef: 's'.repeat(1000) },
            ],
          }),
        ),
      );
      expect(ok.statusCode).toBe(200);

      mockSend.mockReset();
      const bad = await handler(
        makePostEvent(
          validBody({ referents: [{ phrase: 'p', refersTo: 'r', notes: 'n'.repeat(1001) }] }),
        ),
      );
      expect(bad.statusCode).toBe(400);
      expect(JSON.parse(bad.body).message).toMatch(/referents/i);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // --- GET /books/{bookStudyId} ---

  describe('GET /books/{bookStudyId}', () => {
    it('returns 200 with the record when found', async () => {
      const record = { bookStudyId: 'b1', userId: 'u1', book: 'Genesis' };
      mockSend.mockResolvedValueOnce({ Item: record });

      const res = await handler(makeGetBookEvent('u1', 'b1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(record);
    });

    it('returns 404 when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const res = await handler(makeGetBookEvent('u1', 'nonexistent'));
      expect(res.statusCode).toBe(404);
    });
  });

  // --- GET /books ---

  describe('GET /books', () => {
    it('returns 200 with array of book studies', async () => {
      const records = [
        { bookStudyId: 'b1', userId: 'u1' },
        { bookStudyId: 'b2', userId: 'u1' },
      ];
      mockSend.mockResolvedValueOnce({ Items: records });

      const res = await handler(makeListEvent('u1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(records);
    });

    it('returns 200 with empty array when none exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const res = await handler(makeListEvent('u1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('queries GSI1 scoped to the user with ScanIndexForward: false', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await handler(makeListEvent('u1'));

      const queryInput = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      expect(queryInput['IndexName']).toBe('GSI1');
      expect(queryInput['ScanIndexForward']).toBe(false);
      expect(queryInput['ExpressionAttributeValues']).toEqual({ ':pk': 'USER#u1' });
    });
  });

  // --- DELETE /books/{bookStudyId} ---

  describe('DELETE /books/{bookStudyId}', () => {
    it('returns 200 when the record exists and is deleted', async () => {
      mockSend.mockResolvedValueOnce({ Item: { bookStudyId: 'b1' } });
      mockSend.mockResolvedValueOnce({});

      const res = await handler(makeDeleteEvent('u1', 'b1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).message).toMatch(/deleted/i);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('returns 404 when the record does not exist', async () => {
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
     * Property: For any valid BookStudyInput, POST /books returns 200 with a non-empty
     * bookStudyId.
     */
    it('POST /books returns 200 with a non-empty bookStudyId for any valid input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...BIBLE_BOOKS),
          fc.string({ maxLength: 200 }),
          fc.string({ maxLength: 2000 }),
          async (book, title, notes) => {
            mockSend.mockResolvedValueOnce({});

            const res = await handler(makePostEvent(JSON.stringify({ book, title, notes }), 'u1'));
            expect(res.statusCode).toBe(200);
            const parsed = JSON.parse(res.body);
            expect(typeof parsed.bookStudyId).toBe('string');
            expect(parsed.bookStudyId.length).toBeGreaterThan(0);

            mockSend.mockReset();
          },
        ),
      );
    });

    /**
     * Property: a POST then GET round-trip returns a record whose book/title/notes match the
     * input and whose createdAt === updatedAt (no edit path this increment).
     */
    it('create then get round-trip preserves fields (incl. referents) and keeps createdAt === updatedAt', async () => {
      const referentArb = fc.array(
        fc.record({
          phrase: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          refersTo: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          notes: fc.string({ maxLength: 1000 }),
          scrollRef: fc.string({ maxLength: 1000 }),
        }),
        { maxLength: 5 },
      );

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...BIBLE_BOOKS),
          fc.string({ maxLength: 200 }),
          fc.string({ maxLength: 2000 }),
          referentArb,
          async (book, title, notes, referents) => {
            mockSend.mockResolvedValueOnce({});

            const createRes = await handler(
              makePostEvent(JSON.stringify({ book, title, notes, referents }), 'u1'),
            );
            expect(createRes.statusCode).toBe(200);
            const { bookStudyId } = JSON.parse(createRes.body);

            const savedItem = (mockSend.mock.calls[0][0].input as Record<string, unknown>)[
              'Item'
            ] as Record<string, unknown>;

            mockSend.mockResolvedValueOnce({ Item: savedItem });

            const getRes = await handler(makeGetBookEvent('u1', bookStudyId));
            expect(getRes.statusCode).toBe(200);
            const retrieved = JSON.parse(getRes.body);
            expect(retrieved.book).toBe(book);
            expect(retrieved.title).toBe(title);
            expect(retrieved.notes).toBe(notes);
            expect(retrieved.referents).toEqual(referents);
            expect(retrieved.createdAt).toBe(retrieved.updatedAt);

            mockSend.mockReset();
          },
        ),
      );
    });
  });
});
