import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { OutlineGrouping, OutlineParagraph, OutlineStudyRecord } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['OUTLINE_STUDIES_TABLE_NAME'] ?? '';

/** Field length caps (chars). The server rejects over-length input; it never truncates. */
const MAIN_IDEA_MAX = 200;
const TITLE_MAX = 200;
const SHORT_REF_MAX = 50;
const NOTES_MAX = 1000;

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

/** An optional string field: absent → '', present must be a string within `max`. */
function optionalString(value: unknown, max: number): { value: string } | { error: true } {
  if (value === undefined) return { value: '' };
  if (typeof value !== 'string') return { error: true };
  if (value.length > max) return { error: true };
  return { value };
}

interface ParsedBody {
  paragraphs: OutlineParagraph[];
  groupings: OutlineGrouping[];
}

type ParseResult = ParsedBody | { error: string };

/**
 * Parse and validate the PUT body. Server validation never trusts the client:
 * - `paragraphs` is an optional array (absent → []); each has a non-empty `mainIdea` within the cap
 *   and length-checked ref/notes fields.
 * - `groupings` is an optional array (absent → []); each has an integer `column >= 1`, an integer
 *   span `0 <= startIndex <= endIndex < paragraphs.length`, a non-empty `title`, and length-checked
 *   notes. A span out of range or inverted is rejected, so a persisted record can never carry a
 *   non-contiguous or dangling grouping.
 * Any malformed or over-length value is rejected rather than coerced.
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

  // --- paragraphs ---
  const paragraphs: OutlineParagraph[] = [];
  const rawParagraphs = parsed['paragraphs'];
  if (rawParagraphs !== undefined) {
    if (!Array.isArray(rawParagraphs)) return { error: 'paragraphs must be an array.' };
    for (const el of rawParagraphs) {
      if (!isObject(el)) return { error: 'Each paragraph must be an object.' };

      if (typeof el['mainIdea'] !== 'string' || el['mainIdea'].trim().length === 0) {
        return { error: 'paragraph.mainIdea must be a non-empty string.' };
      }
      if (el['mainIdea'].length > MAIN_IDEA_MAX) {
        return { error: `paragraph.mainIdea must be at most ${MAIN_IDEA_MAX} characters.` };
      }

      const startRes = optionalString(el['startRef'], SHORT_REF_MAX);
      if ('error' in startRes)
        return {
          error: `paragraph.startRef must be a string of at most ${SHORT_REF_MAX} characters.`,
        };
      const endRes = optionalString(el['endRef'], SHORT_REF_MAX);
      if ('error' in endRes)
        return {
          error: `paragraph.endRef must be a string of at most ${SHORT_REF_MAX} characters.`,
        };
      const notesRes = optionalString(el['notes'], NOTES_MAX);
      if ('error' in notesRes)
        return { error: `paragraph.notes must be a string of at most ${NOTES_MAX} characters.` };

      paragraphs.push({
        startRef: startRes.value,
        endRef: endRes.value,
        mainIdea: el['mainIdea'],
        notes: notesRes.value,
      });
    }
  }

  // --- groupings (validated against the paragraph count) ---
  const groupings: OutlineGrouping[] = [];
  const rawGroupings = parsed['groupings'];
  if (rawGroupings !== undefined) {
    if (!Array.isArray(rawGroupings)) return { error: 'groupings must be an array.' };
    for (const el of rawGroupings) {
      if (!isObject(el)) return { error: 'Each grouping must be an object.' };

      const column = el['column'];
      if (typeof column !== 'number' || !Number.isInteger(column) || column < 1) {
        return { error: 'grouping.column must be an integer of at least 1.' };
      }

      const startIndex = el['startIndex'];
      const endIndex = el['endIndex'];
      if (
        typeof startIndex !== 'number' ||
        !Number.isInteger(startIndex) ||
        typeof endIndex !== 'number' ||
        !Number.isInteger(endIndex) ||
        startIndex < 0 ||
        endIndex < startIndex ||
        endIndex >= paragraphs.length
      ) {
        return {
          error:
            'grouping.startIndex/endIndex must be integers forming a span within the paragraphs.',
        };
      }

      if (typeof el['title'] !== 'string' || el['title'].trim().length === 0) {
        return { error: 'grouping.title must be a non-empty string.' };
      }
      if (el['title'].length > TITLE_MAX) {
        return { error: `grouping.title must be at most ${TITLE_MAX} characters.` };
      }

      const gNotesRes = optionalString(el['notes'], NOTES_MAX);
      if ('error' in gNotesRes)
        return { error: `grouping.notes must be a string of at most ${NOTES_MAX} characters.` };

      groupings.push({
        column,
        startIndex,
        endIndex,
        title: el['title'],
        notes: gNotesRes.value,
      });
    }
  }

  return { paragraphs, groupings };
}

async function getOutlineStudy(
  userId: string,
  scrollStudyId: string,
): Promise<OutlineStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `OUTLINE#${scrollStudyId}` },
    }),
  );
  return (result.Item as OutlineStudyRecord) ?? null;
}

/**
 * Create-or-replace the outline study for a scroll. Reads before writing so `createdAt` is
 * preserved across updates (== now only on first create) while `updatedAt` always advances.
 */
async function saveOutlineStudy(
  userId: string,
  scrollStudyId: string,
  body: ParsedBody,
): Promise<OutlineStudyRecord> {
  const now = new Date().toISOString();
  const key = { PK: `USER#${userId}`, SK: `OUTLINE#${scrollStudyId}` };

  const existing = await getOutlineStudy(userId, scrollStudyId);
  const createdAt = existing?.createdAt ?? now;

  const record: OutlineStudyRecord = {
    ...key,
    scrollStudyId,
    userId,
    paragraphs: body.paragraphs,
    groupings: body.groupings,
    createdAt,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));
  return record;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    const route = event.resource === '/scroll-studies/{scrollStudyId}/outline';

    // GET /scroll-studies/{scrollStudyId}/outline — fetch the saved outline study
    if (event.httpMethod === 'GET' && route) {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const study = await getOutlineStudy(userId, scrollStudyId);
      if (!study) {
        return corsResponse(404, { message: 'Outline study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // PUT /scroll-studies/{scrollStudyId}/outline — upsert the worksheet
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

      const record = await saveOutlineStudy(userId, scrollStudyId, parsed);
      return corsResponse(200, record, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
