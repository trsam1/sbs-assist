import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock the DynamoDB client before importing the handler
const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: class MockDynamoDBClient {},
  };
});
vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({ send: mockSend }),
    },
    GetCommand: class MockGetCommand {
      constructor(public input: unknown) {}
    },
    QueryCommand: class MockQueryCommand {
      constructor(public input: unknown) {}
    },
  };
});

// Set env vars before importing handler
vi.stubEnv('STRONGS_TABLE_NAME', 'StrongsData');
vi.stubEnv('ALLOWED_ORIGIN', 'https://example.cloudfront.net');

import { handler } from './index';

function makeEvent(
  resource: string,
  strongsNumber?: string,
): { httpMethod: string; resource: string; pathParameters: Record<string, string> | null } {
  return {
    httpMethod: 'GET',
    resource,
    pathParameters: strongsNumber ? { strongsNumber } : null,
  };
}

describe('Strong\'s Lookup Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // --- Validation / 400 responses ---

  describe('input validation', () => {
    it('returns 400 when pathParameters is null', async () => {
      const res = await handler({
        httpMethod: 'GET',
        resource: '/strongs/{strongsNumber}',
        pathParameters: null,
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/Invalid/);
    });

    it('returns 400 for an invalid Strong\'s number', async () => {
      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'X99'));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for an empty string Strong\'s number', async () => {
      const res = await handler(makeEvent('/strongs/{strongsNumber}', ''));
      expect(res.statusCode).toBe(400);
    });

    /**
     * Property: any string NOT matching /^[GH]\d+$/ should be rejected with 400.
     * Validates Requirement 1 correctness property (inverse).
     */
    it('rejects any non-matching string with 400', async () => {
      const invalidStrongs = fc
        .string({ minLength: 1 })
        .filter((s) => !/^[GH]\d+$/.test(s));

      await fc.assert(
        fc.asyncProperty(invalidStrongs, async (input) => {
          const res = await handler(makeEvent('/strongs/{strongsNumber}', input));
          expect(res.statusCode).toBe(400);
        }),
      );
    });
  });

  // --- getStrongsStudyData (GET /strongs/{strongsNumber}) ---

  describe('getStrongsStudyData', () => {
    it('returns definition, original word, transliteration, and lexicon entry', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: {
            definition: 'to love',
            originalWord: 'ἀγαπάω',
            transliteration: 'agapaō',
          },
        })
        .mockResolvedValueOnce({
          Item: { lexiconEntry: 'From ἀγάπη; to love...' },
        });

      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'G25'));
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.strongsNumber).toBe('G25');
      expect(body.definition).toBe('to love');
      expect(body.originalWord).toBe('ἀγαπάω');
      expect(body.transliteration).toBe('agapaō');
      expect(body.lexiconEntry).toBe('From ἀγάπη; to love...');
    });

    it('returns fallback strings when DEF record is missing', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: { lexiconEntry: 'Some lexicon' } });

      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'H157'));
      const body = JSON.parse(res.body);

      expect(body.definition).toBe('Definition not available');
      expect(body.originalWord).toBe('');
      expect(body.transliteration).toBe('');
      expect(body.lexiconEntry).toBe('Some lexicon');
    });

    it('returns fallback string when LEXICON record is missing', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: { definition: 'a def', originalWord: 'word', transliteration: 'trans' },
        })
        .mockResolvedValueOnce({ Item: undefined });

      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'G100'));
      const body = JSON.parse(res.body);

      expect(body.lexiconEntry).toBe('Lexicon entry not available');
      expect(body.definition).toBe('a def');
    });

    it('returns all fallbacks when both records are missing', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: undefined });

      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'G1'));
      const body = JSON.parse(res.body);

      expect(body.definition).toBe('Definition not available');
      expect(body.originalWord).toBe('');
      expect(body.transliteration).toBe('');
      expect(body.lexiconEntry).toBe('Lexicon entry not available');
    });

    /**
     * Property: For any valid Strong's number, the response always contains
     * non-undefined string fields (either real data or fallback).
     * Validates Requirement 2 correctness property.
     */
    it('always returns non-undefined string fields for any valid Strong\'s number', async () => {
      const validStrongs = fc.oneof(
        fc.integer({ min: 1, max: 9999 }).map((n) => `G${n}`),
        fc.integer({ min: 1, max: 9999 }).map((n) => `H${n}`),
      );

      await fc.assert(
        fc.asyncProperty(validStrongs, async (sn) => {
          mockSend
            .mockResolvedValueOnce({ Item: undefined })
            .mockResolvedValueOnce({ Item: undefined });

          const res = await handler(makeEvent('/strongs/{strongsNumber}', sn));
          expect(res.statusCode).toBe(200);

          const body = JSON.parse(res.body);
          expect(typeof body.strongsNumber).toBe('string');
          expect(typeof body.definition).toBe('string');
          expect(typeof body.originalWord).toBe('string');
          expect(typeof body.transliteration).toBe('string');
          expect(typeof body.lexiconEntry).toBe('string');
          expect(body.definition.length).toBeGreaterThan(0);
          expect(body.lexiconEntry.length).toBeGreaterThan(0);

          mockSend.mockReset();
        }),
      );
    });
  });

  // --- getCrossReferences (GET /strongs/{strongsNumber}/cross-references) ---

  describe('getCrossReferences', () => {
    it('returns cross-reference locations with empty notes', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { reference: 'Matthew 5:44' },
          { reference: 'John 3:16' },
          { reference: 'Romans 5:8' },
        ],
      });

      const res = await handler(
        makeEvent('/strongs/{strongsNumber}/cross-references', 'G25'),
      );
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body).toHaveLength(3);
      expect(body[0]).toEqual({ reference: 'Matthew 5:44', notes: '' });
      expect(body[1]).toEqual({ reference: 'John 3:16', notes: '' });
      expect(body[2]).toEqual({ reference: 'Romans 5:8', notes: '' });
    });

    it('returns empty array when no cross-references exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const res = await handler(
        makeEvent('/strongs/{strongsNumber}/cross-references', 'H9999'),
      );
      const body = JSON.parse(res.body);
      expect(body).toEqual([]);
    });

    it('returns empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const res = await handler(
        makeEvent('/strongs/{strongsNumber}/cross-references', 'G50'),
      );
      const body = JSON.parse(res.body);
      expect(body).toEqual([]);
    });

    /**
     * Property: For any valid Strong's number, every element in the
     * cross-references response has a reference string and empty notes.
     * Validates Requirement 3 correctness property.
     */
    it('every cross-reference has a reference string and empty notes', async () => {
      const validStrongs = fc.oneof(
        fc.integer({ min: 1, max: 9999 }).map((n) => `G${n}`),
        fc.integer({ min: 1, max: 9999 }).map((n) => `H${n}`),
      );
      const refList = fc.array(
        fc.stringMatching(/^[A-Z][a-z]+ \d+:\d+$/).map((s) => ({ reference: s })),
        { minLength: 1, maxLength: 10 },
      );

      await fc.assert(
        fc.asyncProperty(validStrongs, refList, async (sn, refs) => {
          mockSend.mockResolvedValueOnce({ Items: refs });

          const res = await handler(
            makeEvent('/strongs/{strongsNumber}/cross-references', sn),
          );
          const body = JSON.parse(res.body);

          expect(body).toHaveLength(refs.length);
          for (const item of body) {
            expect(typeof item.reference).toBe('string');
            expect(item.reference.length).toBeGreaterThan(0);
            expect(item.notes).toBe('');
          }

          mockSend.mockReset();
        }),
      );
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('returns 500 when DynamoDB throws on study data lookup', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));

      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'G25'));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toBe('DynamoDB timeout');
    });

    it('returns 500 when DynamoDB throws on cross-reference query', async () => {
      mockSend.mockRejectedValueOnce(new Error('Throughput exceeded'));

      const res = await handler(
        makeEvent('/strongs/{strongsNumber}/cross-references', 'G25'),
      );
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toBe('Throughput exceeded');
    });

    it('returns generic message for non-Error throws', async () => {
      mockSend.mockRejectedValueOnce('something weird');

      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'G25'));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toBe('Internal server error');
    });
  });

  // --- CORS headers ---

  describe('CORS headers', () => {
    it('includes CORS headers on all responses', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: { definition: 'test' } })
        .mockResolvedValueOnce({ Item: { lexiconEntry: 'test' } });

      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'G25'));
      expect(res.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(res.headers['Access-Control-Allow-Methods']).toContain('GET');
    });

    it('includes CORS headers on error responses', async () => {
      const res = await handler(makeEvent('/strongs/{strongsNumber}', 'INVALID'));
      expect(res.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(res.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});
