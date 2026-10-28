import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { InterrogationEntry, InterrogationStudyRecord } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['INTERROGATION_STUDIES_TABLE_NAME'] ?? '';

/** Field length caps (chars). The server rejects over-length input; it never truncates. */
const QUESTION_MAX = 500;
const PASSAGE_REF_MAX = 50;
const ANSWER_MAX = 4000;
const NOTES_MAX = 1000;
const TAG_MAX = 40;
const TAGS_PER_ENTRY_MAX = 20;

/** The fixed question-kind categories (the 5 Ws + H, plus Other). Mirrors the client constant. */
const CATEGORIES: ReadonlySet<string> = new Set([
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'other',
]);

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

/**
 * Normalize a tag list: trim, lower-case, drop empties, de-duplicate (order preserved). Returns an
 * error when the input is not an array of strings, a normalized tag exceeds TAG_MAX, or the
 * resulting array exceeds TAGS_PER_ENTRY_MAX. Server is authoritative.
 */
function normalizeTags(value: unknown): { value: string[] } | { error: string } {
  if (value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { error: 'entry.tags must be an array of strings.' };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') return { error: 'entry.tags must be an array of strings.' };
    const t = raw.trim().toLowerCase();
    if (t.length === 0) continue;
    if (t.length > TAG_MAX) {
      return { error: `Each tag must be at most ${TAG_MAX} characters.` };
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  if (out.length > TAGS_PER_ENTRY_MAX) {
    return { error: `An entry may have at most ${TAGS_PER_ENTRY_MAX} tags.` };
  }
  return { value: out };
}

type ParseResult = { entries: InterrogationEntry[] } | { error: string };

/**
 * Parse and validate the PUT body. Every field is optional (an absent array → []); strings are
 * length-checked, `question` and `category` are required per entry, `category` must be in the fixed
 * set, and tags are normalized server-side. Any malformed or over-length value is rejected rather
 * than coerced. Order is preserved as sent.
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

  const entries: InterrogationEntry[] = [];
  const rawEntries = parsed['entries'];
  if (rawEntries !== undefined) {
    if (!Array.isArray(rawEntries)) return { error: 'entries must be an array.' };
    for (const el of rawEntries) {
      if (!isObject(el)) return { error: 'Each entry must be an object.' };

      if (typeof el['question'] !== 'string' || el['question'].trim().length === 0) {
        return { error: 'entry.question must be a non-empty string.' };
      }
      if (el['question'].length > QUESTION_MAX) {
        return { error: `entry.question must be at most ${QUESTION_MAX} characters.` };
      }

      if (typeof el['category'] !== 'string' || !CATEGORIES.has(el['category'])) {
        return { error: 'entry.category must be one of the allowed values.' };
      }

      const tagsRes = normalizeTags(el['tags']);
      if ('error' in tagsRes) return { error: tagsRes.error };

      const passageRes = optionalString(el['passageRef'], PASSAGE_REF_MAX);
      if ('error' in passageRes)
        return {
          error: `entry.passageRef must be a string of at most ${PASSAGE_REF_MAX} characters.`,
        };
      const answerRes = optionalString(el['answer'], ANSWER_MAX);
      if ('error' in answerRes)
        return { error: `entry.answer must be a string of at most ${ANSWER_MAX} characters.` };
      const notesRes = optionalString(el['notes'], NOTES_MAX);
      if ('error' in notesRes)
        return { error: `entry.notes must be a string of at most ${NOTES_MAX} characters.` };

      entries.push({
        question: el['question'],
        category: el['category'],
        tags: tagsRes.value,
        passageRef: passageRes.value,
        answer: answerRes.value,
        notes: notesRes.value,
      });
    }
  }

  return { entries };
}

async function getInterrogationStudy(
  userId: string,
  scrollStudyId: string,
): Promise<InterrogationStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `INTERROGATE#${scrollStudyId}` },
    }),
  );
  return (result.Item as InterrogationStudyRecord) ?? null;
}

/**
 * Create-or-replace the interrogation study for a scroll. Reads before writing so `createdAt` is
 * preserved across updates (== now only on first create) while `updatedAt` always advances.
 */
async function saveInterrogationStudy(
  userId: string,
  scrollStudyId: string,
  entries: InterrogationEntry[],
): Promise<InterrogationStudyRecord> {
  const now = new Date().toISOString();
  const key = { PK: `USER#${userId}`, SK: `INTERROGATE#${scrollStudyId}` };

  const existing = await getInterrogationStudy(userId, scrollStudyId);
  const createdAt = existing?.createdAt ?? now;

  const record: InterrogationStudyRecord = {
    ...key,
    scrollStudyId,
    userId,
    entries,
    createdAt,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));
  return record;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    const route = event.resource === '/scroll-studies/{scrollStudyId}/interrogate';

    // GET /scroll-studies/{scrollStudyId}/interrogate — fetch the saved interrogation study
    if (event.httpMethod === 'GET' && route) {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const study = await getInterrogationStudy(userId, scrollStudyId);
      if (!study) {
        return corsResponse(404, { message: 'Interrogation study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // PUT /scroll-studies/{scrollStudyId}/interrogate — upsert the worksheet
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

      const record = await saveInterrogationStudy(userId, scrollStudyId, parsed.entries);
      return corsResponse(200, record, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
