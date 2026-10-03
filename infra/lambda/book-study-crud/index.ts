import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type { BookStudyRecord } from '../shared/models';
import { isValidBook } from '../shared/bible-books';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['BOOK_STUDIES_TABLE_NAME'] ?? '';

const TITLE_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 2000;

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

interface CreateBookStudyInput {
  book: string;
  title: string;
  notes: string;
}

type ParseResult = { input: CreateBookStudyInput } | { error: string };

/** Parse and validate the create body. Server validation never trusts the client. */
function parseCreateBody(body: string | null | undefined): ParseResult {
  if (!body) return { error: 'Invalid or missing request body.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { error: 'Invalid or missing request body.' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'Invalid or missing request body.' };
  }

  const obj = parsed as Record<string, unknown>;

  const book = obj['book'];
  if (typeof book !== 'string' || !isValidBook(book)) {
    return { error: 'Invalid or missing book.' };
  }

  const rawTitle = obj['title'];
  if (rawTitle !== undefined && typeof rawTitle !== 'string') {
    return { error: 'Invalid title.' };
  }
  const title = typeof rawTitle === 'string' ? rawTitle : '';
  if (title.length > TITLE_MAX_LENGTH) {
    return { error: `Title must be ${TITLE_MAX_LENGTH} characters or fewer.` };
  }

  const rawNotes = obj['notes'];
  if (rawNotes !== undefined && typeof rawNotes !== 'string') {
    return { error: 'Invalid notes.' };
  }
  const notes = typeof rawNotes === 'string' ? rawNotes : '';
  if (notes.length > NOTES_MAX_LENGTH) {
    return { error: `Notes must be ${NOTES_MAX_LENGTH} characters or fewer.` };
  }

  return { input: { book, title, notes } };
}

async function createBookStudy(
  userId: string,
  input: CreateBookStudyInput,
): Promise<{ bookStudyId: string }> {
  const now = new Date().toISOString();
  const bookStudyId = randomUUID();

  const record: BookStudyRecord = {
    PK: `USER#${userId}`,
    SK: `BOOKSTUDY#${bookStudyId}`,
    bookStudyId,
    userId,
    book: input.book,
    title: input.title,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `UPDATED#${now}`,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));

  return { bookStudyId };
}

async function getBookStudy(userId: string, bookStudyId: string): Promise<BookStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `BOOKSTUDY#${bookStudyId}` },
    }),
  );

  return (result.Item as BookStudyRecord) ?? null;
}

async function listBookStudies(userId: string): Promise<BookStudyRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}` },
      ScanIndexForward: false,
    }),
  );

  return (result.Items as BookStudyRecord[]) ?? [];
}

async function deleteBookStudy(userId: string, bookStudyId: string): Promise<boolean> {
  const existing = await getBookStudy(userId, bookStudyId);
  if (!existing) return false;

  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `BOOKSTUDY#${bookStudyId}` },
    }),
  );

  return true;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    // POST /books — create a book study
    if (event.httpMethod === 'POST' && event.resource === '/books') {
      const userId = getUserId(event);
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }

      const parsed = parseCreateBody(event.body);
      if ('error' in parsed) {
        return corsResponse(400, { message: parsed.error }, origin);
      }

      const result = await createBookStudy(userId, parsed.input);
      return corsResponse(200, result, origin);
    }

    // GET /books — list book studies for a user
    if (event.httpMethod === 'GET' && event.resource === '/books') {
      const userId = getUserId(event);
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }

      const bookStudies = await listBookStudies(userId);
      return corsResponse(200, bookStudies, origin);
    }

    // GET /books/{bookStudyId} — fetch a single book study
    if (event.httpMethod === 'GET' && event.resource === '/books/{bookStudyId}') {
      const userId = getUserId(event);
      const bookStudyId = event.pathParameters?.['bookStudyId'] ?? '';

      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!bookStudyId) {
        return corsResponse(400, { message: 'Missing bookStudyId path parameter.' }, origin);
      }

      const bookStudy = await getBookStudy(userId, bookStudyId);
      if (!bookStudy) {
        return corsResponse(404, { message: 'Book study not found.' }, origin);
      }

      return corsResponse(200, bookStudy, origin);
    }

    // DELETE /books/{bookStudyId} — delete a book study
    if (event.httpMethod === 'DELETE' && event.resource === '/books/{bookStudyId}') {
      const userId = getUserId(event);
      const bookStudyId = event.pathParameters?.['bookStudyId'] ?? '';

      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!bookStudyId) {
        return corsResponse(400, { message: 'Missing bookStudyId path parameter.' }, origin);
      }

      const deleted = await deleteBookStudy(userId, bookStudyId);
      if (!deleted) {
        return corsResponse(404, { message: 'Book study not found.' }, origin);
      }

      return corsResponse(200, { message: 'Book study deleted.' }, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
