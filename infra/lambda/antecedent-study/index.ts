import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AntecedentAssignment, AntecedentStudyRecord } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['ANTECEDENT_STUDIES_TABLE_NAME'] ?? '';

/** Maximum antecedent length (chars, after trim). The server rejects over-length, never truncates. */
const ANTECEDENT_MAX_LENGTH = 200;

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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

type ParseResult = { assignments: AntecedentAssignment[] } | { error: string };

/**
 * Parse and validate the PUT body. Server validation never trusts the client: it trims each
 * antecedent, drops the empties (unassigned rows), and rejects malformed or over-length input.
 */
function parsePutBody(body: string | null | undefined): ParseResult {
  if (!body) return { error: 'Request body is required.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { error: 'Invalid JSON body.' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'Invalid request body.' };
  }

  const raw = (parsed as Record<string, unknown>)['assignments'];
  if (!Array.isArray(raw)) {
    return { error: 'assignments must be an array.' };
  }

  const assignments: AntecedentAssignment[] = [];
  for (const element of raw) {
    if (typeof element !== 'object' || element === null) {
      return { error: 'Each assignment must be an object.' };
    }
    const obj = element as Record<string, unknown>;
    if (!isNonNegativeInteger(obj['occurrence'])) {
      return { error: 'occurrence must be a non-negative integer.' };
    }
    if (!isNonNegativeInteger(obj['start'])) {
      return { error: 'start must be a non-negative integer.' };
    }
    if (typeof obj['word'] !== 'string' || obj['word'].length === 0) {
      return { error: 'word must be a non-empty string.' };
    }
    if (typeof obj['antecedent'] !== 'string') {
      return { error: 'antecedent must be a string.' };
    }
    const antecedent = obj['antecedent'].trim();
    if (antecedent.length === 0) {
      continue; // unassigned row — drop it, not an error
    }
    if (antecedent.length > ANTECEDENT_MAX_LENGTH) {
      return { error: `antecedent must be ${ANTECEDENT_MAX_LENGTH} characters or fewer.` };
    }
    assignments.push({
      occurrence: obj['occurrence'],
      start: obj['start'],
      word: obj['word'],
      antecedent,
    });
  }

  return { assignments };
}

async function getAntecedentStudy(
  userId: string,
  scrollStudyId: string,
): Promise<AntecedentStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `ANTECEDENT#${scrollStudyId}` },
    }),
  );
  return (result.Item as AntecedentStudyRecord) ?? null;
}

/**
 * Create-or-replace the antecedent study for a scroll. Reads before writing so `createdAt` is
 * preserved across updates (== now only on first create) while `updatedAt` always advances.
 */
async function saveAntecedentStudy(
  userId: string,
  scrollStudyId: string,
  assignments: AntecedentAssignment[],
): Promise<void> {
  const now = new Date().toISOString();
  const key = { PK: `USER#${userId}`, SK: `ANTECEDENT#${scrollStudyId}` };

  const existing = await getAntecedentStudy(userId, scrollStudyId);
  const createdAt = existing?.createdAt ?? now;

  const record: AntecedentStudyRecord = {
    ...key,
    scrollStudyId,
    userId,
    assignments,
    createdAt,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    // GET /scroll-studies/{scrollStudyId}/antecedents — fetch the saved antecedent study
    if (
      event.httpMethod === 'GET' &&
      event.resource === '/scroll-studies/{scrollStudyId}/antecedents'
    ) {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const study = await getAntecedentStudy(userId, scrollStudyId);
      if (!study) {
        return corsResponse(404, { message: 'Antecedent study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // PUT /scroll-studies/{scrollStudyId}/antecedents — upsert the assignments
    if (
      event.httpMethod === 'PUT' &&
      event.resource === '/scroll-studies/{scrollStudyId}/antecedents'
    ) {
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

      await saveAntecedentStudy(userId, scrollStudyId, parsed.assignments);
      return corsResponse(200, { message: 'Antecedent study saved.' }, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
