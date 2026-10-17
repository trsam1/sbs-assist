import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { OutlineNode, OutlineStudyRecord } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['OUTLINE_STUDIES_TABLE_NAME'] ?? '';

/** Field length caps (chars). The server rejects over-length input; it never truncates. */
const TITLE_MAX = 200;
const SHORT_REF_MAX = 50;
const NOTES_MAX = 1000;

/** The deepest nesting level a node may carry (0 = "I", 3 = "a"). */
const MAX_LEVEL = 3;

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
  nodes: OutlineNode[];
}

type ParseResult = ParsedBody | { error: string };

/**
 * Parse and validate the PUT body. Server validation never trusts the client: `nodes` is an
 * optional array (absent → []), each node's `title` must be a non-empty string within the cap,
 * `level` must be an integer in 0..MAX_LEVEL, and the ref/notes fields are length-checked. Any
 * malformed or over-length value is rejected rather than coerced.
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

  const nodes: OutlineNode[] = [];
  const rawNodes = parsed['nodes'];
  if (rawNodes !== undefined) {
    if (!Array.isArray(rawNodes)) return { error: 'nodes must be an array.' };
    for (const el of rawNodes) {
      if (!isObject(el)) return { error: 'Each node must be an object.' };

      if (typeof el['title'] !== 'string' || el['title'].trim().length === 0) {
        return { error: 'node.title must be a non-empty string.' };
      }
      if (el['title'].length > TITLE_MAX) {
        return { error: `node.title must be at most ${TITLE_MAX} characters.` };
      }

      const level = el['level'];
      if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
        return { error: `node.level must be an integer between 0 and ${MAX_LEVEL}.` };
      }

      const startRes = optionalString(el['startRef'], SHORT_REF_MAX);
      if ('error' in startRes)
        return { error: `node.startRef must be a string of at most ${SHORT_REF_MAX} characters.` };
      const endRes = optionalString(el['endRef'], SHORT_REF_MAX);
      if ('error' in endRes)
        return { error: `node.endRef must be a string of at most ${SHORT_REF_MAX} characters.` };
      const notesRes = optionalString(el['notes'], NOTES_MAX);
      if ('error' in notesRes)
        return { error: `node.notes must be a string of at most ${NOTES_MAX} characters.` };

      nodes.push({
        title: el['title'],
        level,
        startRef: startRes.value,
        endRef: endRes.value,
        notes: notesRes.value,
      });
    }
  }

  return { nodes };
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
    nodes: body.nodes,
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
