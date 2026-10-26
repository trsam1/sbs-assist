import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DynamoDB doc client, the S3 client, and the presigner before importing the handler.
const { mockSend, mockS3Send, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockS3Send: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class MockDynamoDBClient {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
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
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = mockS3Send;
  },
  PutObjectCommand: class MockPutObjectCommand {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class MockDeleteObjectCommand {
    constructor(public input: unknown) {}
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));
vi.mock('node:crypto', () => ({ randomUUID: () => 'scroll-uuid-1234' }));

vi.stubEnv('SCROLL_STUDIES_TABLE_NAME', 'ScrollStudies');
vi.stubEnv('BOOK_STUDIES_TABLE_NAME', 'BookStudies');
vi.stubEnv('UPLOADS_BUCKET_NAME', 'uploads-bucket');
vi.stubEnv('ALLOWED_ORIGINS', 'https://example.cloudfront.net');

import { handler } from './index';

type UserId = string | null;

function authContext(userId: UserId) {
  return userId ? { authorizer: { claims: { sub: userId } } } : undefined;
}

function makeCreateEvent(body: string | null, userId: UserId = 'user-1') {
  return {
    httpMethod: 'POST',
    resource: '/scroll-studies',
    body,
    headers: {},
    pathParameters: null,
    requestContext: authContext(userId),
  };
}

function makeGetEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies/{scrollStudyId}',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makeListEvent(userId: UserId) {
  return {
    httpMethod: 'GET',
    resource: '/scroll-studies',
    headers: {},
    pathParameters: null,
    body: null,
    requestContext: authContext(userId),
  };
}

function makeDeleteEvent(userId: UserId, scrollStudyId: string | null) {
  return {
    httpMethod: 'DELETE',
    resource: '/scroll-studies/{scrollStudyId}',
    headers: {},
    pathParameters: scrollStudyId ? { scrollStudyId } : null,
    body: null,
    requestContext: authContext(userId),
  };
}

function validCreateBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    bookStudyId: 'book-1',
    filename: 'genesis.pdf',
    contentType: 'application/pdf',
    ...overrides,
  });
}

/** A book-study record as returned by the GetCommand during link validation. */
const bookStudyItem = {
  PK: 'USER#u1',
  SK: 'BOOKSTUDY#book-1',
  bookStudyId: 'book-1',
  userId: 'u1',
  book: 'Genesis',
};

describe('Scroll Study Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockS3Send.mockReset();
    mockGetSignedUrl.mockReset();
  });

  describe('POST /scroll-studies', () => {
    it('creates a record (status uploading), derives bookName from the book study, returns id/uploadUrl/objectKey', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: bookStudyItem }) // GetCommand: book study
        .mockResolvedValueOnce({ Items: [] }) // QueryCommand: no existing scroll
        .mockResolvedValueOnce({}); // PutCommand
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/presigned-put');

      const res = await handler(makeCreateEvent(validCreateBody(), 'u1'));
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.scrollStudyId).toBe('scroll-uuid-1234');
      expect(body.uploadUrl).toBe('https://s3.example/presigned-put');
      expect(body.objectKey).toBe('uploads/u1/scroll-uuid-1234.pdf');

      const item = (mockSend.mock.calls[2][0].input as Record<string, unknown>)['Item'] as Record<
        string,
        unknown
      >;
      expect(item['PK']).toBe('USER#u1');
      expect(item['SK']).toBe('SCROLL#scroll-uuid-1234');
      expect(item['status']).toBe('uploading');
      expect(item['bookStudyId']).toBe('book-1');
      expect(item['bookName']).toBe('Genesis'); // derived from the book study, not the body
      expect(item['objectKey']).toBe('uploads/u1/scroll-uuid-1234.pdf');
      expect(item['GSI1PK']).toBe('USER#u1');
    });

    it('ignores any client userId; the key uses the Cognito sub', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: bookStudyItem })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({});
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/x');
      const res = await handler(makeCreateEvent(validCreateBody({ userId: 'attacker' }), 'u1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).objectKey).toBe('uploads/u1/scroll-uuid-1234.pdf');
    });

    it('lower-cases the extension in the object key', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: bookStudyItem })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({});
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/x');
      const res = await handler(
        makeCreateEvent(validCreateBody({ filename: 'Genesis.DOCX' }), 'u1'),
      );
      expect(JSON.parse(res.body).objectKey).toBe('uploads/u1/scroll-uuid-1234.docx');
    });

    it('rejects a disallowed extension with 400 and no write', async () => {
      const res = await handler(makeCreateEvent(validCreateBody({ filename: 'book.doc' })));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('rejects a missing bookStudyId with 400 and no write', async () => {
      const res = await handler(makeCreateEvent(validCreateBody({ bookStudyId: '   ' })));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("rejects a bookStudyId that does not resolve to one of the user's book studies with 400", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand: not found
      const res = await handler(makeCreateEvent(validCreateBody(), 'u1'));
      expect(res.statusCode).toBe(400);
      // no PutCommand issued
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('returns 409 when a scroll already exists for the book study', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: bookStudyItem }) // GetCommand: book study
        .mockResolvedValueOnce({ Items: [{ scrollStudyId: 'existing' }] }); // QueryCommand: a scroll exists
      const res = await handler(makeCreateEvent(validCreateBody(), 'u1'));
      expect(res.statusCode).toBe(409);
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('rejects a null body with 400', async () => {
      const res = await handler(makeCreateEvent(null));
      expect(res.statusCode).toBe(400);
    });

    it('rejects when there are no auth claims with 400', async () => {
      const res = await handler(makeCreateEvent(validCreateBody(), null));
      expect(res.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('GET /scroll-studies', () => {
    it('queries GSI1 newest-first scoped to the user', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ scrollStudyId: 's1' }] });
      const res = await handler(makeListEvent('u1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([{ scrollStudyId: 's1' }]);

      const input = mockSend.mock.calls[0][0].input as Record<string, unknown>;
      expect(input['IndexName']).toBe('GSI1');
      expect(input['ScanIndexForward']).toBe(false);
      expect((input['ExpressionAttributeValues'] as Record<string, unknown>)[':pk']).toBe(
        'USER#u1',
      );
    });

    it('rejects without auth claims', async () => {
      const res = await handler(makeListEvent(null));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /scroll-studies/{scrollStudyId}', () => {
    it('returns the study scoped by sub', async () => {
      const study = { scrollStudyId: 's1', userId: 'u1' };
      mockSend.mockResolvedValueOnce({ Item: study });
      const res = await handler(makeGetEvent('u1', 's1'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(study);
      const key = (mockSend.mock.calls[0][0].input as Record<string, unknown>)['Key'] as Record<
        string,
        unknown
      >;
      expect(key['PK']).toBe('USER#u1');
      expect(key['SK']).toBe('SCROLL#s1');
    });

    it("returns 404 for another user's id (not under their PK)", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const res = await handler(makeGetEvent('u1', 'someone-elses-id'));
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /scroll-studies/{scrollStudyId}', () => {
    it('deletes the record and best-effort deletes the S3 object', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: { scrollStudyId: 's1', objectKey: 'uploads/u1/s1.pdf' } }) // get
        .mockResolvedValueOnce({}); // delete
      mockS3Send.mockResolvedValueOnce({});

      const res = await handler(makeDeleteEvent('u1', 's1'));
      expect(res.statusCode).toBe(200);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const s3Input = mockS3Send.mock.calls[0][0].input as Record<string, unknown>;
      expect(s3Input['Key']).toBe('uploads/u1/s1.pdf');
    });

    it('still succeeds if the S3 delete fails', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: { scrollStudyId: 's1', objectKey: 'uploads/u1/s1.pdf' } })
        .mockResolvedValueOnce({});
      mockS3Send.mockRejectedValueOnce(new Error('S3 down'));

      const res = await handler(makeDeleteEvent('u1', 's1'));
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 for another user's id and does not touch S3", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const res = await handler(makeDeleteEvent('u1', 'nope'));
      expect(res.statusCode).toBe(404);
      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });

  describe('unknown routes', () => {
    it('returns 404', async () => {
      const res = await handler({
        httpMethod: 'PATCH',
        resource: '/unknown',
        headers: {},
        pathParameters: null,
        body: null,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('error handling', () => {
    it('returns 500 when DynamoDB throws', async () => {
      mockSend.mockRejectedValueOnce(new Error('DDB timeout'));
      const res = await handler(makeCreateEvent(validCreateBody()));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toBe('DDB timeout');
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers on responses', async () => {
      const res = await handler(makeListEvent(null));
      expect(res.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});
