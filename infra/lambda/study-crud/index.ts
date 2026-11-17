import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type { WordStudyEntry, WordStudyRecord } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['WORD_STUDIES_TABLE_NAME'] ?? '';

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

interface SaveStudyBody {
  id?: string;
  userId: string;
  createdAt?: string;
  wordStudies: WordStudyEntry[];
  /** undefined = the client did not say (keep what is stored); [] = unlink from every book. */
  bookStudyIds?: string[];
}

const BOOK_ID_MAX_LENGTH = 64;
const BOOK_IDS_MAX = 66;
const BOOK_ID_PATTERN = /^[A-Za-z0-9-]+$/;

const BOOK_IDS_MESSAGE =
  'bookStudyIds must be an array of at most 66 ids (letters, digits, hyphens; 64 characters or fewer each).';

/**
 * Validate and de-duplicate `bookStudyIds`. Returns the cleaned list, or null when it is invalid.
 * Duplicates are removed before the length check so repeating an id never trips the limit.
 */
function parseBookStudyIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  for (const entry of raw) {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.length > BOOK_ID_MAX_LENGTH ||
      !BOOK_ID_PATTERN.test(entry)
    ) {
      return null;
    }
    seen.add(entry);
  }
  if (seen.size > BOOK_IDS_MAX) return null;
  return [...seen];
}

type ParsedSave = { ok: true; body: SaveStudyBody } | { ok: false; message: string };

function parseSaveBody(body: string | null | undefined): ParsedSave | null {
  if (!body) return null;

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;

    if (!Array.isArray(obj['wordStudies'])) return null;

    let bookStudyIds: string[] | undefined;
    if (obj['bookStudyIds'] !== undefined) {
      const cleaned = parseBookStudyIds(obj['bookStudyIds']);
      if (cleaned === null) return { ok: false, message: BOOK_IDS_MESSAGE };
      bookStudyIds = cleaned;
    }

    return {
      ok: true,
      body: {
        id: typeof obj['id'] === 'string' && obj['id'].length > 0 ? obj['id'] : undefined,
        userId: '', // Will be set from Cognito claims
        createdAt:
          typeof obj['createdAt'] === 'string' && obj['createdAt'].length > 0
            ? (obj['createdAt'] as string)
            : undefined,
        wordStudies: obj['wordStudies'] as WordStudyEntry[],
        bookStudyIds,
      },
    };
  } catch {
    return null;
  }
}

async function saveWordStudy(body: SaveStudyBody): Promise<{ studyId: string }> {
  const now = new Date().toISOString();
  const studyId = body.id ?? randomUUID();

  // Saves overwrite the whole record, so a client that does not mention the links must not erase them.
  let bookStudyIds = body.bookStudyIds;
  if (bookStudyIds === undefined && body.id) {
    const existing = await getStudy(body.userId, studyId);
    bookStudyIds = existing?.bookStudyIds;
  }

  const record: WordStudyRecord = {
    PK: `USER#${body.userId}`,
    SK: `STUDY#${studyId}`,
    studyId,
    userId: body.userId,
    createdAt: body.createdAt ?? now,
    updatedAt: now,
    wordStudies: body.wordStudies,
    ...(bookStudyIds && bookStudyIds.length > 0 ? { bookStudyIds } : {}),
    GSI1PK: `USER#${body.userId}`,
    GSI1SK: `UPDATED#${now}`,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));

  return { studyId };
}

async function getStudy(userId: string, studyId: string): Promise<WordStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `STUDY#${studyId}` },
    }),
  );

  return (result.Item as WordStudyRecord) ?? null;
}

async function listStudies(userId: string): Promise<WordStudyRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}` },
      ScanIndexForward: false,
    }),
  );

  return (result.Items as WordStudyRecord[]) ?? [];
}

async function deleteStudy(userId: string, studyId: string): Promise<boolean> {
  const existing = await getStudy(userId, studyId);
  if (!existing) return false;

  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `STUDY#${studyId}` },
    }),
  );

  return true;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    // POST /studies — save a word study
    if (event.httpMethod === 'POST' && event.resource === '/studies') {
      const userId = getUserId(event);
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }

      const parsedSave = parseSaveBody(event.body);
      if (!parsedSave) {
        return corsResponse(
          400,
          {
            message: 'Invalid request body. Required: wordStudies (array).',
          },
          origin,
        );
      }
      if (!parsedSave.ok) {
        return corsResponse(400, { message: parsedSave.message }, origin);
      }
      const body = parsedSave.body;

      // Override userId with the authenticated Cognito user
      body.userId = userId;
      const result = await saveWordStudy(body);
      return corsResponse(200, result, origin);
    }

    // GET /studies/{studyId} — fetch a single study
    if (event.httpMethod === 'GET' && event.resource === '/studies/{studyId}') {
      const userId = getUserId(event);
      const studyId = event.pathParameters?.['studyId'] ?? '';

      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!studyId) {
        return corsResponse(400, { message: 'Missing studyId path parameter.' }, origin);
      }

      const study = await getStudy(userId, studyId);
      if (!study) {
        return corsResponse(404, { message: 'Study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // GET /studies — list studies for a user
    if (event.httpMethod === 'GET' && event.resource === '/studies') {
      const userId = getUserId(event);

      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }

      const studies = await listStudies(userId);
      return corsResponse(200, studies, origin);
    }

    // DELETE /studies/{studyId} — delete a study
    if (event.httpMethod === 'DELETE' && event.resource === '/studies/{studyId}') {
      const userId = getUserId(event);
      const studyId = event.pathParameters?.['studyId'] ?? '';

      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!studyId) {
        return corsResponse(400, { message: 'Missing studyId path parameter.' }, origin);
      }

      const deleted = await deleteStudy(userId, studyId);
      if (!deleted) {
        return corsResponse(404, { message: 'Study not found.' }, origin);
      }

      return corsResponse(200, { message: 'Study deleted.' }, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
