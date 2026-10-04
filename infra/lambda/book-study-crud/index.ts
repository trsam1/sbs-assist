import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type { BookStudyRecord, Referent } from '../shared/models';
import { isValidBook } from '../shared/bible-books';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['BOOK_STUDIES_TABLE_NAME'] ?? '';

const TITLE_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 2000;
const REFERENT_FIELD_MAX = 200;
const REFERENT_LONG_MAX = 1000;

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

interface SaveBookStudyInput {
  id?: string;
  book: string;
  title: string;
  notes: string;
  referents: Referent[];
}

type ParseResult = { input: SaveBookStudyInput } | { error: string };

/**
 * Validate a referents array per entry, mirroring the raw-length rule used for title/notes
 * (`length > max` rejects, so the limit value itself is allowed). phrase/refersTo are required
 * (non-empty after trim); notes/scrollRef default to '' when absent.
 */
function parseReferents(raw: unknown): { referents: Referent[] } | { error: string } {
  if (raw === undefined) return { referents: [] };
  if (!Array.isArray(raw)) {
    return { error: 'Invalid referents: expected an array.' };
  }

  const referents: Referent[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return { error: 'Invalid referents: each entry must be an object.' };
    }
    const e = entry as Record<string, unknown>;

    const phrase = e['phrase'];
    const refersTo = e['refersTo'];
    if (typeof phrase !== 'string' || typeof refersTo !== 'string') {
      return { error: 'Invalid referents: phrase and refersTo must be strings.' };
    }
    if (phrase.trim().length === 0 || refersTo.trim().length === 0) {
      return { error: 'Invalid referents: phrase and refersTo are required.' };
    }
    if (phrase.length > REFERENT_FIELD_MAX || refersTo.length > REFERENT_FIELD_MAX) {
      return {
        error: `Invalid referents: phrase and refersTo must be ${REFERENT_FIELD_MAX} characters or fewer.`,
      };
    }

    const rawEntryNotes = e['notes'];
    if (rawEntryNotes !== undefined && typeof rawEntryNotes !== 'string') {
      return { error: 'Invalid referents: notes must be a string.' };
    }
    const notes = typeof rawEntryNotes === 'string' ? rawEntryNotes : '';

    const rawScrollRef = e['scrollRef'];
    if (rawScrollRef !== undefined && typeof rawScrollRef !== 'string') {
      return { error: 'Invalid referents: scrollRef must be a string.' };
    }
    const scrollRef = typeof rawScrollRef === 'string' ? rawScrollRef : '';

    if (notes.length > REFERENT_LONG_MAX || scrollRef.length > REFERENT_LONG_MAX) {
      return {
        error: `Invalid referents: notes and scrollRef must be ${REFERENT_LONG_MAX} characters or fewer.`,
      };
    }

    referents.push({ phrase, refersTo, notes, scrollRef });
  }

  return { referents };
}

/** Parse and validate the save (upsert) body. Server validation never trusts the client. */
function parseSaveBody(body: string | null | undefined): ParseResult {
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

  const rawId = obj['id'];
  const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : undefined;

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

  const referentsResult = parseReferents(obj['referents']);
  if ('error' in referentsResult) {
    return { error: referentsResult.error };
  }

  return { input: { id, book, title, notes, referents: referentsResult.referents } };
}

async function saveBookStudy(
  userId: string,
  input: SaveBookStudyInput,
): Promise<{ bookStudyId: string }> {
  const now = new Date().toISOString();
  const bookStudyId = input.id ?? randomUUID();

  // createdAt preservation is server-owned: on the update path read the caller's own record
  // (PK from claims.sub) and reuse its createdAt; fall back to now when none exists (create).
  let createdAt = now;
  if (input.id) {
    const existing = await getBookStudy(userId, bookStudyId);
    if (existing) createdAt = existing.createdAt;
  }

  const record: BookStudyRecord = {
    PK: `USER#${userId}`,
    SK: `BOOKSTUDY#${bookStudyId}`,
    bookStudyId,
    userId,
    book: input.book,
    title: input.title,
    notes: input.notes,
    createdAt,
    updatedAt: now,
    referents: input.referents,
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
    // POST /books — create or update (upsert) a book study
    if (event.httpMethod === 'POST' && event.resource === '/books') {
      const userId = getUserId(event);
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }

      const parsed = parseSaveBody(event.body);
      if ('error' in parsed) {
        return corsResponse(400, { message: parsed.error }, origin);
      }

      const result = await saveBookStudy(userId, parsed.input);
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
