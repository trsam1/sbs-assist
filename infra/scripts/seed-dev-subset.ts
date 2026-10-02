/**
 * Seeds the dev StrongsData table from the committed fixture. Run by the dev deploy job.
 *
 * Usage: STRONGS_TABLE_NAME=StrongsData-dev npm run seed-dev
 * Exit:  0 seeded / already seeded, 1 AWS error or exhausted retries, 2 non-dev table.
 *
 * Idempotency: a dedicated sentinel item is written only AFTER every batch succeeds, so a
 * partial seed is repaired by simply re-running (all writes are idempotent puts).
 * Bump SENTINEL.SK whenever the fixture contents change.
 */
import * as fs from 'fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { FIXTURE_PATH } from './export-dev-subset';

export const SENTINEL = { PK: 'SEED#dev-subset', SK: 'V1' } as const;
const BATCH_SIZE = 25;
const MAX_TRIES = 5;

export class DevTableError extends Error {}

/** Returns the name if it ends with '-dev'; otherwise throws DevTableError. */
export function assertDevTable(name: string | undefined): string {
  if (!name || !name.endsWith('-dev')) {
    throw new DevTableError(`Refusing to seed non-dev table: ${name ?? '(unset)'}`);
  }
  return name;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type WriteRequest = { PutRequest: { Item: Record<string, unknown> } };

export async function seedDevSubset(opts: {
  client: DynamoDBDocumentClient;
  tableName: string;
  items: Record<string, unknown>[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<'seeded' | 'already seeded'> {
  const { client, tableName, items } = opts;
  const sleep = opts.sleep ?? defaultSleep;

  const existing = await client.send(new GetCommand({ TableName: tableName, Key: { ...SENTINEL } }));
  if (existing.Item) return 'already seeded';

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    let pending: WriteRequest[] = items.slice(i, i + BATCH_SIZE).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt >= MAX_TRIES) {
        throw new Error(`${pending.length} unprocessed items after ${MAX_TRIES} tries (batch ${i / BATCH_SIZE + 1})`);
      }
      if (attempt > 0) await sleep(100 * 2 ** attempt);
      const res = await client.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
      pending = (res.UnprocessedItems?.[tableName] as WriteRequest[] | undefined) ?? [];
    }
  }

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: { ...SENTINEL, itemCount: items.length, seededAt: new Date().toISOString() },
    }),
  );
  return 'seeded';
}

export async function main(): Promise<number> {
  try {
    const tableName = assertDevTable(process.env['STRONGS_TABLE_NAME']);
    const items = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>[];
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const result = await seedDevSubset({ client, tableName, items });
    console.log(result === 'seeded' ? `Seeded ${items.length} items into ${tableName}` : 'already seeded');
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return err instanceof DevTableError ? 2 : 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}
