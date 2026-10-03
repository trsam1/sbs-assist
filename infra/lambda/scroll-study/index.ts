import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { ScrollStudyRecord } from '../shared/models';
import { uploadExtension } from '../shared/validation';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3 = new S3Client({});

const tableName = process.env['SCROLL_STUDIES_TABLE_NAME'] ?? '';
const uploadsBucket = process.env['UPLOADS_BUCKET_NAME'] ?? '';

/** Short-lived presigned PUT TTL, in seconds. */
const UPLOAD_URL_TTL_SECONDS = 300;

/** Maximum book-name length (chars, after trim). */
const MAX_BOOK_NAME_LENGTH = 100;

interface APIGatewayEvent {
  httpMethod: string;
  resource: string;
  pathParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  requestContext?: {
    authorizer?: {
      claims?: Record<string, string>;
    };
  };
}

/** Extract the Cognito user ID (sub) from the authorizer claims. */
function getUserId(event: APIGatewayEvent): string {
  return event.requestContext?.authorizer?.claims?.['sub'] ?? '';
}

interface CreateBody {
  bookName: string;
  filename: string;
  contentType: string;
}

/** Parse and validate the create-scroll-study body. Returns null on any validation failure. */
function parseCreateBody(
  body: string | null | undefined,
): { ok: true; value: CreateBody } | { ok: false; message: string } {
  if (!body) return { ok: false, message: 'Request body is required.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, message: 'Invalid JSON body.' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, message: 'Invalid request body.' };
  }

  const obj = parsed as Record<string, unknown>;
  const bookNameRaw = typeof obj['bookName'] === 'string' ? obj['bookName'].trim() : '';
  const filename = typeof obj['filename'] === 'string' ? obj['filename'] : '';
  const contentType =
    typeof obj['contentType'] === 'string' && obj['contentType'].length > 0
      ? obj['contentType']
      : 'application/octet-stream';

  if (bookNameRaw.length < 1 || bookNameRaw.length > MAX_BOOK_NAME_LENGTH) {
    return { ok: false, message: 'bookName is required and must be 1–100 characters.' };
  }
  if (uploadExtension(filename) === null) {
    return { ok: false, message: 'Unsupported file type. Allowed: .pdf, .docx, .txt.' };
  }

  return { ok: true, value: { bookName: bookNameRaw, filename, contentType } };
}

async function createScrollStudy(
  userId: string,
  input: CreateBody,
): Promise<{ scrollStudyId: string; uploadUrl: string; objectKey: string }> {
  const now = new Date().toISOString();
  const scrollStudyId = randomUUID();
  const ext = uploadExtension(input.filename);
  const objectKey = `uploads/${userId}/${scrollStudyId}.${ext}`;

  const record: ScrollStudyRecord = {
    PK: `USER#${userId}`,
    SK: `SCROLL#${scrollStudyId}`,
    scrollStudyId,
    userId,
    bookName: input.bookName,
    objectKey,
    status: 'uploading',
    scrollText: '',
    truncated: false,
    failureReason: '',
    createdAt: now,
    updatedAt: now,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `UPDATED#${now}`,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: uploadsBucket,
      Key: objectKey,
      ContentType: input.contentType,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );

  return { scrollStudyId, uploadUrl, objectKey };
}

async function getScrollStudy(
  userId: string,
  scrollStudyId: string,
): Promise<ScrollStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `SCROLL#${scrollStudyId}` },
    }),
  );
  return (result.Item as ScrollStudyRecord) ?? null;
}

async function listScrollStudies(userId: string): Promise<ScrollStudyRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}` },
      ScanIndexForward: false,
    }),
  );
  return (result.Items as ScrollStudyRecord[]) ?? [];
}

async function deleteScrollStudy(userId: string, scrollStudyId: string): Promise<boolean> {
  const existing = await getScrollStudy(userId, scrollStudyId);
  if (!existing) return false;

  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `SCROLL#${scrollStudyId}` },
    }),
  );

  // Best-effort delete of the uploaded S3 object; swallow failures (record is already gone).
  if (existing.objectKey) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: uploadsBucket, Key: existing.objectKey }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to delete S3 object ${existing.objectKey}: ${message}`);
    }
  }

  return true;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    // POST /scroll-studies — create a scroll study + presigned upload URL
    if (event.httpMethod === 'POST' && event.resource === '/scroll-studies') {
      const userId = getUserId(event);
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }

      const parsed = parseCreateBody(event.body);
      if (!parsed.ok) {
        return corsResponse(400, { message: parsed.message }, origin);
      }

      const result = await createScrollStudy(userId, parsed.value);
      return corsResponse(200, result, origin);
    }

    // GET /scroll-studies — list the user's scroll studies
    if (event.httpMethod === 'GET' && event.resource === '/scroll-studies') {
      const userId = getUserId(event);
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }

      const studies = await listScrollStudies(userId);
      return corsResponse(200, studies, origin);
    }

    // GET /scroll-studies/{scrollStudyId} — fetch one scroll study
    if (event.httpMethod === 'GET' && event.resource === '/scroll-studies/{scrollStudyId}') {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const study = await getScrollStudy(userId, scrollStudyId);
      if (!study) {
        return corsResponse(404, { message: 'Scroll study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // DELETE /scroll-studies/{scrollStudyId} — delete record + uploaded object
    if (event.httpMethod === 'DELETE' && event.resource === '/scroll-studies/{scrollStudyId}') {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const deleted = await deleteScrollStudy(userId, scrollStudyId);
      if (!deleted) {
        return corsResponse(404, { message: 'Scroll study not found.' }, origin);
      }

      return corsResponse(200, { message: 'Scroll study deleted.' }, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
