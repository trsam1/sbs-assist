/**
 * One-off, local: export a small Strong's subset from prod StrongsData (READ-ONLY Query)
 * into scripts/fixtures/strongs-dev-subset.json, which seeds the dev stack.
 *
 * Usage: npm run export-dev-subset
 * Env:   SOURCE_TABLE_NAME (default StrongsData), XREF_CAP (default 50, integer 1..50)
 * Exit:  0 written, 1 query error / missing DEF / bad item (nothing written), 2 bad config.
 *
 * Not run in CI. Data comes from openly licensed Open Scriptures / public-domain sources.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export const DEV_SUBSET_NUMBERS = [
  'G25',
  'G26',
  'G5368',
  'G4102',
  'G5485',
  'G3056',
  'G1680',
  'H157',
  'H2617',
  'H7965',
] as const;

export const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'strongs-dev-subset.json');

type Item = Record<string, unknown>;

export class ExportConfigError extends Error {}

/** XREF_CAP: default 50; must be an integer in 1..50. */
export function parseXrefCap(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 50;
  if (!/^\d+$/.test(raw))
    throw new ExportConfigError(`XREF_CAP must be an integer 1..50, got "${raw}"`);
  const n = Number(raw);
  if (n < 1 || n > 50)
    throw new ExportConfigError(`XREF_CAP must be an integer 1..50, got "${raw}"`);
  return n;
}

/** Plain code-unit order (locale-independent, so the fixture is deterministic). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const comparePkSk = (a: Item, b: Item) =>
  cmp(String(a['PK']), String(b['PK'])) || cmp(String(a['SK']), String(b['SK']));

/**
 * Queries each number's partition and keeps DEF, LEXICON, and the first `xrefCap` XREF#
 * items (by SK). Throws when a DEF is missing or an item lacks a string PK/SK.
 * Returns the items sorted by PK then SK.
 */
export async function exportDevSubset(opts: {
  client: DynamoDBDocumentClient;
  tableName: string;
  numbers: readonly string[];
  xrefCap: number;
  log?: (msg: string) => void;
}): Promise<Item[]> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const out: Item[] = [];
  for (const num of opts.numbers) {
    const pk = `STRONGS#${num}`;
    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await opts.client.send(
        new QueryCommand({
          TableName: opts.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...((res.Items ?? []) as Item[]));
      startKey = res.LastEvaluatedKey;
    } while (startKey);

    for (const item of items) {
      if (typeof item['PK'] !== 'string' || typeof item['SK'] !== 'string') {
        throw new Error(`Item without string PK/SK for ${num}`);
      }
    }
    const def = items.find((i) => i['SK'] === 'DEF');
    if (!def) throw new Error(`DEF missing for ${num}`);
    const lexicon = items.find((i) => i['SK'] === 'LEXICON');
    if (!lexicon) log(`LEXICON missing for ${num}`);
    const xrefs = items
      .filter((i) => String(i['SK']).startsWith('XREF#'))
      .sort(comparePkSk)
      .slice(0, opts.xrefCap);
    out.push(def, ...(lexicon ? [lexicon] : []), ...xrefs);
  }
  return out.sort(comparePkSk);
}

export async function main(): Promise<number> {
  let xrefCap: number;
  try {
    xrefCap = parseXrefCap(process.env['XREF_CAP']);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const tableName = process.env['SOURCE_TABLE_NAME'] || 'StrongsData';
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  try {
    const items = await exportDevSubset({
      client,
      tableName,
      numbers: DEV_SUBSET_NUMBERS,
      xrefCap,
    });
    const json = JSON.stringify(items, null, 2) + '\n';
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, json);
    console.log(
      `Wrote ${items.length} items (${Buffer.byteLength(json)} bytes) to ${FIXTURE_PATH}`,
    );
    return 0;
  } catch (err) {
    console.error(`Export failed: ${(err as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}
