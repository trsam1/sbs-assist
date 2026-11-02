import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { MemorizationChunk, MemorizationStudyRecord } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['MEMORIZATION_STUDIES_TABLE_NAME'] ?? '';

/** Field caps. The server rejects over-limit input; it never truncates. */
const VERSE_REF_MAX = 50;
const CHUNKS_MAX = 2000;
/** SM-2 ease floor; mirrors the client srs.ts MIN_EASE. */
const MIN_EASE = 1.3;
/** Max length of an ISO date / timestamp string on a schedule field. */
const DATE_MAX = 40;

/** The learned-progress ladder. Mirrors the client type. */
const STATES: ReadonlySet<string> = new Set(['new', 'learning', 'chained', 'solid']);

/** Accepts a date-only (YYYY-MM-DD) or a full ISO timestamp; used only for structural validation. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

type ParseResult = { chunks: MemorizationChunk[] } | { error: string };

/**
 * Parse and validate the PUT body. `chunks` is optional (absent → []); the array is capped and each
 * chunk validated: integer offsets with start < end, a `verseRef` string within cap (location only,
 * never verse text — the server never fetches scrollText to check offsets against it), and a
 * `state` in the fixed ladder. The v2 SM-2 scheduling fields (easeFactor/intervalDays/repetitions/
 * dueDate/lastReviewed) are OPTIONAL and validated only when present; the server stores them as
 * given and computes no schedule. Any malformed value is rejected rather than coerced. Order is
 * preserved as sent.
 */
function parsePutBody(body: string | null | undefined): ParseResult {
  if (!body) return { error: 'Request body is required.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { error: 'Invalid JSON body.' };
  }
  if (!isObject(parsed)) {
    return { error: 'Invalid request body.' };
  }

  const chunks: MemorizationChunk[] = [];
  const rawChunks = parsed['chunks'];
  if (rawChunks !== undefined) {
    if (!Array.isArray(rawChunks)) return { error: 'chunks must be an array.' };
    if (rawChunks.length > CHUNKS_MAX) {
      return { error: `A study may have at most ${CHUNKS_MAX} chunks.` };
    }
    for (const el of rawChunks) {
      if (!isObject(el)) return { error: 'Each chunk must be an object.' };

      if (!isNonNegativeInt(el['start']) || !isNonNegativeInt(el['end'])) {
        return { error: 'chunk.start and chunk.end must be non-negative integers.' };
      }
      if ((el['start'] as number) >= (el['end'] as number)) {
        return { error: 'chunk.start must be less than chunk.end.' };
      }

      if (typeof el['verseRef'] !== 'string' || el['verseRef'].length > VERSE_REF_MAX) {
        return { error: `chunk.verseRef must be a string of at most ${VERSE_REF_MAX} characters.` };
      }

      if (typeof el['state'] !== 'string' || !STATES.has(el['state'])) {
        return { error: 'chunk.state must be one of the allowed values.' };
      }

      // --- v2 SM-2 scheduling fields: all OPTIONAL, validated only when present. The server
      // stores them as given and computes NO schedule (SM-2 is owned by the client srs.ts). A v1
      // chunk carrying none of these stays valid. ---
      if (el['easeFactor'] !== undefined) {
        if (
          typeof el['easeFactor'] !== 'number' ||
          !Number.isFinite(el['easeFactor']) ||
          (el['easeFactor'] as number) < MIN_EASE
        ) {
          return { error: `chunk.easeFactor must be a finite number >= ${MIN_EASE}.` };
        }
      }
      if (el['intervalDays'] !== undefined && !isNonNegativeInt(el['intervalDays'])) {
        return { error: 'chunk.intervalDays must be a non-negative integer.' };
      }
      if (el['repetitions'] !== undefined && !isNonNegativeInt(el['repetitions'])) {
        return { error: 'chunk.repetitions must be a non-negative integer.' };
      }
      for (const dateKey of ['dueDate', 'lastReviewed'] as const) {
        const v = el[dateKey];
        if (v !== undefined) {
          if (typeof v !== 'string' || v.length > DATE_MAX || (v !== '' && !ISO_DATE_RE.test(v))) {
            return { error: `chunk.${dateKey} must be '' or an ISO date string.` };
          }
        }
      }

      const chunk: MemorizationChunk = {
        start: el['start'] as number,
        end: el['end'] as number,
        verseRef: el['verseRef'],
        state: el['state'] as MemorizationChunk['state'],
      };
      // Pass the optional fields through only when present — keeps v1 items byte-identical.
      if (el['easeFactor'] !== undefined) chunk.easeFactor = el['easeFactor'] as number;
      if (el['intervalDays'] !== undefined) chunk.intervalDays = el['intervalDays'] as number;
      if (el['repetitions'] !== undefined) chunk.repetitions = el['repetitions'] as number;
      if (el['dueDate'] !== undefined) chunk.dueDate = el['dueDate'] as string;
      if (el['lastReviewed'] !== undefined) chunk.lastReviewed = el['lastReviewed'] as string;
      chunks.push(chunk);
    }
  }

  return { chunks };
}

async function getMemorizationStudy(
  userId: string,
  scrollStudyId: string,
): Promise<MemorizationStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `MEMORIZE#${scrollStudyId}` },
    }),
  );
  return (result.Item as MemorizationStudyRecord) ?? null;
}

/**
 * Create-or-replace the memorization study for a scroll. Reads before writing so `createdAt` is
 * preserved across updates (== now only on first create) while `updatedAt` always advances.
 */
async function saveMemorizationStudy(
  userId: string,
  scrollStudyId: string,
  chunks: MemorizationChunk[],
): Promise<MemorizationStudyRecord> {
  const now = new Date().toISOString();
  const key = { PK: `USER#${userId}`, SK: `MEMORIZE#${scrollStudyId}` };

  const existing = await getMemorizationStudy(userId, scrollStudyId);
  const createdAt = existing?.createdAt ?? now;

  const record: MemorizationStudyRecord = {
    ...key,
    scrollStudyId,
    userId,
    chunks,
    createdAt,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));
  return record;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    const route = event.resource === '/scroll-studies/{scrollStudyId}/memorize';

    // GET /scroll-studies/{scrollStudyId}/memorize — fetch the saved memorization study
    if (event.httpMethod === 'GET' && route) {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const study = await getMemorizationStudy(userId, scrollStudyId);
      if (!study) {
        return corsResponse(404, { message: 'Memorization study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // PUT /scroll-studies/{scrollStudyId}/memorize — upsert the worksheet
    if (event.httpMethod === 'PUT' && route) {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const parsed = parsePutBody(event.body);
      if ('error' in parsed) {
        return corsResponse(400, { message: parsed.error }, origin);
      }

      const record = await saveMemorizationStudy(userId, scrollStudyId, parsed.chunks);
      return corsResponse(200, record, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
