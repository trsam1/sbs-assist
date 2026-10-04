import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ScrollStatus, ScrollStudyRecord } from '../shared/models';
import { SCROLL_TEXT_LIMIT } from '../shared/models';
import { MAX_UPLOAD_BYTES, uploadExtension } from '../shared/validation';
import { extractText } from './extract';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3 = new S3Client({});

const tableName = process.env['SCROLL_STUDIES_TABLE_NAME'] ?? '';

/** Keys the extractor acts on: `uploads/<userId>/<scrollStudyId>.<ext>`. */
const KEY_PATTERN = /^uploads\/([^/]+)\/([^/]+)\.(pdf|docx|txt)$/;

interface S3EventRecord {
  s3?: {
    bucket?: { name?: string };
    object?: { key?: string; size?: number };
  };
}

interface S3Event {
  Records?: S3EventRecord[];
}

interface ParsedKey {
  userId: string;
  scrollStudyId: string;
  ext: 'pdf' | 'docx' | 'txt';
}

/** Parse an uploads key into its parts, or null if it does not match the expected shape. */
function parseKey(key: string): ParsedKey | null {
  const decoded = decodeURIComponent(key.replace(/\+/g, ' '));
  const match = KEY_PATTERN.exec(decoded);
  if (!match) return null;
  const ext = uploadExtension(decoded);
  if (ext === null) return null;
  return { userId: match[1], scrollStudyId: match[2], ext };
}

/** Partial status update on a scroll study, keyed by user + id. */
async function updateStatus(
  userId: string,
  scrollStudyId: string,
  fields: Partial<Pick<ScrollStudyRecord, 'status' | 'scrollText' | 'truncated' | 'failureReason'>>,
): Promise<void> {
  const status: ScrollStatus | undefined = fields.status;
  const now = new Date().toISOString();

  const names: Record<string, string> = { '#updatedAt': 'updatedAt', '#gsi1sk': 'GSI1SK' };
  const values: Record<string, unknown> = { ':updatedAt': now, ':gsi1sk': `UPDATED#${now}` };
  const sets = ['#updatedAt = :updatedAt', '#gsi1sk = :gsi1sk'];

  if (status !== undefined) {
    names['#status'] = 'status';
    values[':status'] = status;
    sets.push('#status = :status');
  }
  if (fields.scrollText !== undefined) {
    names['#scrollText'] = 'scrollText';
    values[':scrollText'] = fields.scrollText;
    sets.push('#scrollText = :scrollText');
  }
  if (fields.truncated !== undefined) {
    names['#truncated'] = 'truncated';
    values[':truncated'] = fields.truncated;
    sets.push('#truncated = :truncated');
  }
  if (fields.failureReason !== undefined) {
    names['#failureReason'] = 'failureReason';
    values[':failureReason'] = fields.failureReason;
    sets.push('#failureReason = :failureReason');
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `SCROLL#${scrollStudyId}` },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** Read the full body of an S3 object as a Buffer. */
async function readObject(bucket: string, key: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) {
    throw new Error('Empty S3 object body.');
  }
  return Buffer.from(await body.transformToByteArray());
}

/** Resolve the object's size, preferring the event value and falling back to HeadObject. */
async function objectSize(
  bucket: string,
  key: string,
  eventSize: number | undefined,
): Promise<number> {
  if (typeof eventSize === 'number') return eventSize;
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return head.ContentLength ?? 0;
}

async function processRecord(record: S3EventRecord): Promise<void> {
  const bucket = record.s3?.bucket?.name ?? '';
  const rawKey = record.s3?.object?.key ?? '';
  const parsed = parseKey(rawKey);

  if (!bucket || !parsed) {
    console.warn(`Ignoring object with unexpected key shape: "${rawKey}"`);
    return;
  }

  const { userId, scrollStudyId, ext } = parsed;
  const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));

  // (1) Reflect progress for the UI poller.
  await updateStatus(userId, scrollStudyId, { status: 'extracting' });

  // (2) Authoritative server-side size gate — never download an oversized object.
  const size = await objectSize(bucket, key, record.s3?.object?.size);
  if (size > MAX_UPLOAD_BYTES) {
    await updateStatus(userId, scrollStudyId, {
      status: 'failed',
      failureReason: 'file too large',
    });
    return;
  }

  // (3) Download, extract, and store (truncating to the inline limit).
  const buffer = await readObject(bucket, key);
  const result = await extractText(buffer, ext);

  if (!result.ok) {
    await updateStatus(userId, scrollStudyId, {
      status: 'failed',
      failureReason: result.reason,
    });
    return;
  }

  const full = Buffer.from(result.text, 'utf8');
  const truncated = full.length > SCROLL_TEXT_LIMIT;
  const scrollText = truncated ? full.subarray(0, SCROLL_TEXT_LIMIT).toString('utf8') : result.text;

  await updateStatus(userId, scrollStudyId, {
    status: 'ready',
    scrollText,
    truncated,
    failureReason: '',
  });
}

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records ?? []) {
    await processRecord(record);
  }
};
