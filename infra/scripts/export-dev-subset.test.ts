import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend, writeFileSync } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: class MockQueryCommand {
    constructor(public input: { ExpressionAttributeValues: Record<string, string> }) {}
  },
}));
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  return { ...real, writeFileSync, mkdirSync: vi.fn() };
});

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DEV_SUBSET_NUMBERS, exportDevSubset, main, parseXrefCap } from './export-dev-subset';

type Item = Record<string, unknown>;

/** Builds a partition: DEF, LEXICON (optional), and n XREF items in shuffled order. */
function partition(num: string, xrefs: number, lexicon = true): Item[] {
  const pk = `STRONGS#${num}`;
  const items: Item[] = Array.from({ length: xrefs }, (_, i) => ({
    PK: pk,
    SK: `XREF#${String(xrefs - i).padStart(3, '0')}`,
    reference: `Ref ${i}`,
  }));
  if (lexicon) items.push({ PK: pk, SK: 'LEXICON', lexiconEntry: 'lex' });
  items.push({ PK: pk, SK: 'DEF', definition: `def ${num}` });
  return items;
}

function serve(partitions: Record<string, Item[]>) {
  mockSend.mockImplementation(
    async (cmd: { input: { ExpressionAttributeValues: Record<string, string> } }) => ({
      Items: partitions[cmd.input.ExpressionAttributeValues[':pk']] ?? [],
    }),
  );
}

const client = { send: mockSend } as unknown as DynamoDBDocumentClient;

describe('parseXrefCap', () => {
  it('defaults to 50', () => {
    expect(parseXrefCap(undefined)).toBe(50);
    expect(parseXrefCap('')).toBe(50);
  });
  it('accepts 1..50', () => {
    expect(parseXrefCap('1')).toBe(1);
    expect(parseXrefCap('20')).toBe(20);
    expect(parseXrefCap('50')).toBe(50);
  });
  it('rejects 0, 51, and non-integers', () => {
    for (const bad of ['0', '51', 'abc', '2.5', '-1'])
      expect(() => parseXrefCap(bad)).toThrow(/XREF_CAP/);
  });
});

describe('exportDevSubset', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('applies the XREF cap per number, keeping the first by SK, and sorts by PK then SK', async () => {
    serve({ 'STRONGS#G26': partition('G26', 5), 'STRONGS#G25': partition('G25', 5) });
    const items = await exportDevSubset({
      client,
      tableName: 'StrongsData',
      numbers: ['G26', 'G25'],
      xrefCap: 2,
    });
    expect(items.map((i) => `${i['PK']} ${i['SK']}`)).toEqual([
      'STRONGS#G25 DEF',
      'STRONGS#G25 LEXICON',
      'STRONGS#G25 XREF#001',
      'STRONGS#G25 XREF#002',
      'STRONGS#G26 DEF',
      'STRONGS#G26 LEXICON',
      'STRONGS#G26 XREF#001',
      'STRONGS#G26 XREF#002',
    ]);
  });

  it('queries the source table read-only with no -dev restriction', async () => {
    serve({ 'STRONGS#G25': partition('G25', 0) });
    await exportDevSubset({ client, tableName: 'StrongsData', numbers: ['G25'], xrefCap: 50 });
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: 'StrongsData',
      KeyConditionExpression: 'PK = :pk',
    });
  });

  it('logs and allows a missing LEXICON', async () => {
    serve({ 'STRONGS#H157': partition('H157', 1, false) });
    const log = vi.fn();
    const items = await exportDevSubset({
      client,
      tableName: 'StrongsData',
      numbers: ['H157'],
      xrefCap: 50,
      log,
    });
    expect(log).toHaveBeenCalledWith('LEXICON missing for H157');
    expect(items.map((i) => i['SK'])).toEqual(['DEF', 'XREF#001']);
  });

  it('throws when a DEF is missing', async () => {
    serve({ 'STRONGS#G25': partition('G25', 2).filter((i) => i['SK'] !== 'DEF') });
    await expect(
      exportDevSubset({ client, tableName: 'StrongsData', numbers: ['G25'], xrefCap: 50 }),
    ).rejects.toThrow('DEF missing for G25');
  });

  it('throws when an item lacks a string PK/SK', async () => {
    serve({ 'STRONGS#G25': [...partition('G25', 1), { PK: 'STRONGS#G25', SK: 7 }] });
    await expect(
      exportDevSubset({ client, tableName: 'StrongsData', numbers: ['G25'], xrefCap: 50 }),
    ).rejects.toThrow(/string PK\/SK/);
  });
});

describe('main', () => {
  beforeEach(() => {
    mockSend.mockReset();
    writeFileSync.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  for (const bad of ['0', '51', 'abc']) {
    it(`returns 2 for XREF_CAP=${bad} without querying`, async () => {
      vi.stubEnv('XREF_CAP', bad);
      await expect(main()).resolves.toBe(2);
      expect(mockSend).not.toHaveBeenCalled();
      expect(writeFileSync).not.toHaveBeenCalled();
    });
  }

  it('returns 1 and writes nothing when a DEF is missing', async () => {
    const partitions: Record<string, Item[]> = {};
    for (const n of DEV_SUBSET_NUMBERS) partitions[`STRONGS#${n}`] = partition(n, 1);
    partitions['STRONGS#H7965'] = partitions['STRONGS#H7965'].filter((i) => i['SK'] !== 'DEF');
    serve(partitions);
    await expect(main()).resolves.toBe(1);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('writes the sorted fixture from the default StrongsData table', async () => {
    const partitions: Record<string, Item[]> = {};
    for (const n of DEV_SUBSET_NUMBERS) partitions[`STRONGS#${n}`] = partition(n, 1);
    serve(partitions);
    await expect(main()).resolves.toBe(0);
    expect(mockSend.mock.calls[0][0].input.TableName).toBe('StrongsData');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeFileSync.mock.calls[0][1] as string) as Item[];
    expect(written).toHaveLength(30);
    expect(written[0]).toMatchObject({ PK: 'STRONGS#G1680', SK: 'DEF' });
  });
});
