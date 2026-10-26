import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { FigureEntry, FigureGroup, FiguresStudyRecord } from '../shared/models';
import { FIGURE_TYPE_GROUP, FIGURE_TYPE_IDS, FIGURE_GROUPS } from '../shared/figure-types';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['FIGURES_STUDIES_TABLE_NAME'] ?? '';

/** Field length caps (chars). The server rejects over-length input; it never truncates. */
const OTHER_LABEL_MAX = 100;
const REF_MAX = 200;
const TEXT_MAX = 2000;
const INTERP_MAX = 2000;
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
  entries: FigureEntry[];
}

type ParseResult = ParsedBody | { error: string };

/**
 * Parse and validate the PUT body. Server validation never trusts the client: `entries` is
 * optional (absent → []), each entry's figureType must be a known id or 'other' (with a non-empty
 * otherLabel), `reference` is required, free-text fields are length-checked, and each entry's
 * `group` is RECOMPUTED from its figureType (a lying body group is overwritten) — for 'other',
 * the body group is honoured but validated to the two allowed values.
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

  const entries: FigureEntry[] = [];
  const rawEntries = parsed['entries'];
  if (rawEntries !== undefined) {
    if (!Array.isArray(rawEntries)) return { error: 'entries must be an array.' };
    for (const el of rawEntries) {
      if (!isObject(el)) return { error: 'Each entry must be an object.' };

      const figureType = el['figureType'];
      if (typeof figureType !== 'string' || figureType.length === 0) {
        return { error: 'entry.figureType is required.' };
      }
      const isOther = figureType === 'other';
      if (!isOther && !FIGURE_TYPE_IDS.has(figureType)) {
        return { error: 'entry.figureType must be a known figure type or "other".' };
      }

      // otherLabel: required non-empty when 'other', must be '' (or absent) otherwise.
      let otherLabel = '';
      if (isOther) {
        const raw = el['otherLabel'];
        if (typeof raw !== 'string' || raw.trim().length === 0) {
          return { error: 'entry.otherLabel is required when figureType is "other".' };
        }
        if (raw.length > OTHER_LABEL_MAX) {
          return { error: `entry.otherLabel must be at most ${OTHER_LABEL_MAX} characters.` };
        }
        otherLabel = raw;
      }

      // group: recomputed from a known type; for 'other' take the (validated) body group.
      let group: FigureGroup;
      if (isOther) {
        const raw = el['group'];
        if (typeof raw !== 'string' || !FIGURE_GROUPS.has(raw)) {
          return { error: 'entry.group must be "parallelism" or "figure" for an "other" type.' };
        }
        group = raw as FigureGroup;
      } else {
        group = FIGURE_TYPE_GROUP[figureType] as FigureGroup;
      }

      // reference: required, non-empty.
      const ref = el['reference'];
      if (typeof ref !== 'string' || ref.trim().length === 0) {
        return { error: 'entry.reference is required.' };
      }
      if (ref.length > REF_MAX) {
        return { error: `entry.reference must be at most ${REF_MAX} characters.` };
      }

      const textRes = optionalString(el['text'], TEXT_MAX);
      if ('error' in textRes)
        return { error: `entry.text must be a string of at most ${TEXT_MAX} characters.` };
      const interpRes = optionalString(el['interpretation'], INTERP_MAX);
      if ('error' in interpRes)
        return {
          error: `entry.interpretation must be a string of at most ${INTERP_MAX} characters.`,
        };
      const notesRes = optionalString(el['notes'], NOTES_MAX);
      if ('error' in notesRes)
        return { error: `entry.notes must be a string of at most ${NOTES_MAX} characters.` };

      entries.push({
        figureType,
        otherLabel,
        group,
        reference: ref,
        text: textRes.value,
        interpretation: interpRes.value,
        notes: notesRes.value,
      });
    }
  }

  return { entries };
}

async function getFiguresStudy(
  userId: string,
  scrollStudyId: string,
): Promise<FiguresStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `FIGURES#${scrollStudyId}` },
    }),
  );
  return (result.Item as FiguresStudyRecord) ?? null;
}

/**
 * Create-or-replace the figures study for a scroll. Reads before writing so `createdAt` is
 * preserved across updates (== now only on first create) while `updatedAt` always advances.
 */
async function saveFiguresStudy(
  userId: string,
  scrollStudyId: string,
  body: ParsedBody,
): Promise<FiguresStudyRecord> {
  const now = new Date().toISOString();
  const key = { PK: `USER#${userId}`, SK: `FIGURES#${scrollStudyId}` };

  const existing = await getFiguresStudy(userId, scrollStudyId);
  const createdAt = existing?.createdAt ?? now;

  const record: FiguresStudyRecord = {
    ...key,
    scrollStudyId,
    userId,
    entries: body.entries,
    createdAt,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));
  return record;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    const route = event.resource === '/scroll-studies/{scrollStudyId}/figures';

    // GET /scroll-studies/{scrollStudyId}/figures — fetch the saved figures study
    if (event.httpMethod === 'GET' && route) {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const study = await getFiguresStudy(userId, scrollStudyId);
      if (!study) {
        return corsResponse(404, { message: 'Figures study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // PUT /scroll-studies/{scrollStudyId}/figures — upsert the worksheet
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

      const record = await saveFiguresStudy(userId, scrollStudyId, parsed);
      return corsResponse(200, record, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
