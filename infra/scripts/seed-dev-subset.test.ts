import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { assertDevTable, DevTableError, seedDevSubset, SENTINEL } from './seed-dev-subset';
import { DEV_SUBSET_NUMBERS, FIXTURE_PATH } from './export-dev-subset';

const TABLE = 'StrongsData-dev';
const noSleep = () => Promise.resolve();

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ PK: `STRONGS#G${i}`, SK: 'DEF', definition: `d${i}` }));
}

describe('assertDevTable', () => {
  it('accepts a -dev table', () => {
    expect(assertDevTable('StrongsData-dev')).toBe('StrongsData-dev');
  });

  it('refuses non-dev and missing names', () => {
    expect(() => assertDevTable('StrongsData')).toThrow(DevTableError);
    expect(() => assertDevTable(undefined)).toThrow(DevTableError);
    expect(() => assertDevTable('')).toThrow(/Refusing to seed non-dev table/);
  });
});

describe('seedDevSubset', () => {
  const send = vi.fn();
  const client = { send } as unknown as DynamoDBDocumentClient;

  beforeEach(() => {
    send.mockReset();
  });

  const calls = () => send.mock.calls.map(([cmd]) => cmd);

  it('skips everything when the sentinel exists', async () => {
    send.mockResolvedValueOnce({ Item: { ...SENTINEL } });
    await expect(seedDevSubset({ client, tableName: TABLE, items: makeItems(3), sleep: noSleep })).resolves.toBe(
      'already seeded',
    );
    expect(send).toHaveBeenCalledTimes(1);
    const [get] = calls();
    expect(get).toBeInstanceOf(GetCommand);
    expect(get.input).toEqual({ TableName: TABLE, Key: { PK: 'SEED#dev-subset', SK: 'V1' } });
  });

  it('writes 26 items in 2 batches, then the sentinel', async () => {
    send.mockResolvedValueOnce({}).mockResolvedValue({ UnprocessedItems: {} });
    await expect(seedDevSubset({ client, tableName: TABLE, items: makeItems(26), sleep: noSleep })).resolves.toBe(
      'seeded',
    );
    const c = calls();
    expect(c).toHaveLength(4);
    expect(c[1]).toBeInstanceOf(BatchWriteCommand);
    expect(c[1].input.RequestItems[TABLE]).toHaveLength(25);
    expect(c[2]).toBeInstanceOf(BatchWriteCommand);
    expect(c[2].input.RequestItems[TABLE]).toHaveLength(1);
    expect(c[3]).toBeInstanceOf(PutCommand);
    expect(c[3].input.TableName).toBe(TABLE);
    expect(c[3].input.Item).toMatchObject({ PK: 'SEED#dev-subset', SK: 'V1', itemCount: 26 });
    expect(typeof c[3].input.Item.seededAt).toBe('string');
  });

  it('retries unprocessed items with backoff', async () => {
    const sleep = vi.fn(noSleep);
    const items = makeItems(3);
    send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ UnprocessedItems: { [TABLE]: [{ PutRequest: { Item: items[2] } }] } })
      .mockResolvedValueOnce({ UnprocessedItems: {} })
      .mockResolvedValueOnce({});
    await expect(seedDevSubset({ client, tableName: TABLE, items, sleep })).resolves.toBe('seeded');
    const c = calls();
    expect(c[2].input.RequestItems[TABLE]).toEqual([{ PutRequest: { Item: items[2] } }]);
    expect(sleep).toHaveBeenCalledWith(200);
    expect(c[3]).toBeInstanceOf(PutCommand);
  });

  it('does not write the sentinel when a later batch exhausts its retries', async () => {
    const items = makeItems(30);
    send.mockImplementation(async (cmd: { input: { RequestItems?: Record<string, unknown[]> } }) => {
      if (cmd instanceof GetCommand) return {};
      if (cmd instanceof BatchWriteCommand) {
        const reqs = cmd.input.RequestItems![TABLE];
        // Batch 1 (25 items) succeeds; batch 2 never drains.
        return reqs.length === 25 ? { UnprocessedItems: {} } : { UnprocessedItems: { [TABLE]: reqs } };
      }
      throw new Error('unexpected command');
    });
    await expect(seedDevSubset({ client, tableName: TABLE, items, sleep: noSleep })).rejects.toThrow(
      /unprocessed items after 5 tries \(batch 2\)/,
    );
    expect(calls().some((c) => c instanceof PutCommand)).toBe(false);
    expect(calls().filter((c) => c instanceof BatchWriteCommand)).toHaveLength(1 + 5);
  });

  it('does not write the sentinel when a batch throws', async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('throttled'));
    await expect(seedDevSubset({ client, tableName: TABLE, items: makeItems(26), sleep: noSleep })).rejects.toThrow(
      'throttled',
    );
    expect(calls().some((c) => c instanceof PutCommand)).toBe(false);
  });
});

describe('committed fixture', () => {
  const items = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>[];

  it('has string PK and SK on every item', () => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof item['PK']).toBe('string');
      expect(typeof item['SK']).toBe('string');
    }
  });

  it('contains no typed DynamoDB JSON values', () => {
    const typed = (v: unknown) =>
      !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && ['S', 'N', 'M', 'L'].includes(Object.keys(v)[0]);
    for (const item of items) {
      for (const value of Object.values(item)) expect(typed(value)).toBe(false);
    }
  });

  it('has a DEF item for each of the 10 subset numbers', () => {
    const defs = items.filter((i) => i['SK'] === 'DEF').map((i) => i['PK']);
    expect(defs.sort()).toEqual(DEV_SUBSET_NUMBERS.map((n) => `STRONGS#${n}`).sort());
  });

  it("has a non-empty string definition for G25 (smoke check 4)", () => {
    const g25 = items.find((i) => i['PK'] === 'STRONGS#G25' && i['SK'] === 'DEF');
    expect(typeof g25?.['definition']).toBe('string');
    expect((g25?.['definition'] as string).length).toBeGreaterThan(0);
  });
});
