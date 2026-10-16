import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  StructureMarker,
  StructureSection,
  StructureElement,
  StructureStudyRecord,
} from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['STRUCTURE_STUDIES_TABLE_NAME'] ?? '';

/** Field length caps (chars). The server rejects over-length input; it never truncates. */
const GENRE_MAX = 200;
const TONE_MAX = 2000;
const PHRASE_MAX = 200;
const REF_MAX = 200;
const SHORT_REF_MAX = 50;
const NOTES_MAX = 1000;
const LABEL_MAX = 200;
const ELEMENT_MAX = 200;

const MARKER_KINDS: ReadonlySet<string> = new Set([
  'transition',
  'direct-address',
  'declarative',
  'command',
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

interface ParsedBody {
  genre: string;
  tone: string;
  markers: StructureMarker[];
  sections: StructureSection[];
  elements: StructureElement[];
}

type ParseResult = ParsedBody | { error: string };

/**
 * Parse and validate the PUT body. Server validation never trusts the client: every field is
 * optional (an absent array → []), strings are length-checked, marker kinds are checked against
 * the fixed set, and required sub-fields (marker.phrase, section.label, element.element) must be
 * non-empty strings. Any malformed or over-length value is rejected rather than coerced.
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

  const genreRes = optionalString(parsed['genre'], GENRE_MAX);
  if ('error' in genreRes)
    return { error: `genre must be a string of at most ${GENRE_MAX} characters.` };
  const toneRes = optionalString(parsed['tone'], TONE_MAX);
  if ('error' in toneRes)
    return { error: `tone must be a string of at most ${TONE_MAX} characters.` };

  // markers
  const markers: StructureMarker[] = [];
  const rawMarkers = parsed['markers'];
  if (rawMarkers !== undefined) {
    if (!Array.isArray(rawMarkers)) return { error: 'markers must be an array.' };
    for (const el of rawMarkers) {
      if (!isObject(el)) return { error: 'Each marker must be an object.' };
      if (typeof el['kind'] !== 'string' || !MARKER_KINDS.has(el['kind'])) {
        return { error: 'marker.kind must be one of the allowed values.' };
      }
      if (typeof el['phrase'] !== 'string' || el['phrase'].trim().length === 0) {
        return { error: 'marker.phrase must be a non-empty string.' };
      }
      if (el['phrase'].length > PHRASE_MAX) {
        return { error: `marker.phrase must be at most ${PHRASE_MAX} characters.` };
      }
      const refRes = optionalString(el['ref'], REF_MAX);
      if ('error' in refRes)
        return { error: `marker.ref must be a string of at most ${REF_MAX} characters.` };
      const notesRes = optionalString(el['notes'], NOTES_MAX);
      if ('error' in notesRes)
        return { error: `marker.notes must be a string of at most ${NOTES_MAX} characters.` };
      markers.push({
        kind: el['kind'] as StructureMarker['kind'],
        phrase: el['phrase'],
        ref: refRes.value,
        notes: notesRes.value,
      });
    }
  }

  // sections (order preserved as sent)
  const sections: StructureSection[] = [];
  const rawSections = parsed['sections'];
  if (rawSections !== undefined) {
    if (!Array.isArray(rawSections)) return { error: 'sections must be an array.' };
    for (const el of rawSections) {
      if (!isObject(el)) return { error: 'Each section must be an object.' };
      if (typeof el['label'] !== 'string' || el['label'].trim().length === 0) {
        return { error: 'section.label must be a non-empty string.' };
      }
      if (el['label'].length > LABEL_MAX) {
        return { error: `section.label must be at most ${LABEL_MAX} characters.` };
      }
      const startRes = optionalString(el['startRef'], SHORT_REF_MAX);
      if ('error' in startRes)
        return {
          error: `section.startRef must be a string of at most ${SHORT_REF_MAX} characters.`,
        };
      const endRes = optionalString(el['endRef'], SHORT_REF_MAX);
      if ('error' in endRes)
        return { error: `section.endRef must be a string of at most ${SHORT_REF_MAX} characters.` };
      const notesRes = optionalString(el['notes'], NOTES_MAX);
      if ('error' in notesRes)
        return { error: `section.notes must be a string of at most ${NOTES_MAX} characters.` };
      sections.push({
        label: el['label'],
        startRef: startRes.value,
        endRef: endRes.value,
        notes: notesRes.value,
      });
    }
  }

  // elements (optional chart)
  const elements: StructureElement[] = [];
  const rawElements = parsed['elements'];
  if (rawElements !== undefined) {
    if (!Array.isArray(rawElements)) return { error: 'elements must be an array.' };
    for (const el of rawElements) {
      if (!isObject(el)) return { error: 'Each element must be an object.' };
      if (typeof el['element'] !== 'string' || el['element'].trim().length === 0) {
        return { error: 'element.element must be a non-empty string.' };
      }
      if (el['element'].length > ELEMENT_MAX) {
        return { error: `element.element must be at most ${ELEMENT_MAX} characters.` };
      }
      const refs = el['sectionRefs'];
      if (refs !== undefined && (!Array.isArray(refs) || refs.some((r) => typeof r !== 'string'))) {
        return { error: 'element.sectionRefs must be an array of strings.' };
      }
      elements.push({
        element: el['element'],
        sectionRefs: Array.isArray(refs) ? (refs as string[]) : [],
      });
    }
  }

  return { genre: genreRes.value, tone: toneRes.value, markers, sections, elements };
}

async function getStructureStudy(
  userId: string,
  scrollStudyId: string,
): Promise<StructureStudyRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `STRUCTURE#${scrollStudyId}` },
    }),
  );
  return (result.Item as StructureStudyRecord) ?? null;
}

/**
 * Create-or-replace the structure study for a scroll. Reads before writing so `createdAt` is
 * preserved across updates (== now only on first create) while `updatedAt` always advances.
 */
async function saveStructureStudy(
  userId: string,
  scrollStudyId: string,
  body: ParsedBody,
): Promise<StructureStudyRecord> {
  const now = new Date().toISOString();
  const key = { PK: `USER#${userId}`, SK: `STRUCTURE#${scrollStudyId}` };

  const existing = await getStructureStudy(userId, scrollStudyId);
  const createdAt = existing?.createdAt ?? now;

  const record: StructureStudyRecord = {
    ...key,
    scrollStudyId,
    userId,
    genre: body.genre,
    tone: body.tone,
    markers: body.markers,
    sections: body.sections,
    elements: body.elements,
    createdAt,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));
  return record;
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  try {
    const route = event.resource === '/scroll-studies/{scrollStudyId}/structure';

    // GET /scroll-studies/{scrollStudyId}/structure — fetch the saved structure study
    if (event.httpMethod === 'GET' && route) {
      const userId = getUserId(event);
      const scrollStudyId = event.pathParameters?.['scrollStudyId'] ?? '';
      if (!userId) {
        return corsResponse(400, { message: 'Missing authentication.' }, origin);
      }
      if (!scrollStudyId) {
        return corsResponse(400, { message: 'Missing scrollStudyId path parameter.' }, origin);
      }

      const study = await getStructureStudy(userId, scrollStudyId);
      if (!study) {
        return corsResponse(404, { message: 'Structure study not found.' }, origin);
      }

      return corsResponse(200, study, origin);
    }

    // PUT /scroll-studies/{scrollStudyId}/structure — upsert the worksheet
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

      const record = await saveStructureStudy(userId, scrollStudyId, parsed);
      return corsResponse(200, record, origin);
    }

    return corsResponse(404, { message: 'Not found' }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
