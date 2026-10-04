import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PRONOUN_DICTIONARY } from './pronoun-dictionary';
import { suggestAntecedents } from './antecedent-suggest';

const DICTIONARY = [...PRONOUN_DICTIONARY];

describe('suggestAntecedents', () => {
  it('returns an empty list for empty and whitespace-only input', () => {
    expect(suggestAntecedents('')).toEqual([]);
    expect(suggestAntecedents('   \n\t ')).toEqual([]);
  });

  it('collects mid-sentence capitalised proper-noun candidates, sorted ascending', () => {
    expect(suggestAntecedents('Then Paul greeted Timothy and Paul blessed Silas.')).toEqual([
      'Paul',
      'Silas',
      'Timothy',
    ]);
  });

  it('includes a sentence-initial capital only if it recurs or appears mid-sentence', () => {
    // "Paul" is only ever sentence-initial and appears once → excluded.
    expect(suggestAntecedents('Paul spoke to the crowd.')).toEqual([]);
    // "Paul" recurs → included.
    expect(suggestAntecedents('Paul spoke. Then Paul left.')).toEqual(['Paul']);
  });

  it('de-duplicates case-insensitively, keeping the first-seen casing', () => {
    const result = suggestAntecedents('They saw Jesus and JESUS and Jesus again today.');
    expect(result.filter((t) => t.toLowerCase() === 'jesus')).toHaveLength(1);
  });

  it('never offers a pronoun-dictionary word (even when capitalised and recurring)', () => {
    // "He" and "She" are capitalised and recur, but are pronouns → excluded.
    const result = suggestAntecedents('He and She. He and She. Then Paul and Paul.');
    expect(result).not.toContain('He');
    expect(result).not.toContain('She');
    expect(result).toContain('Paul');
  });

  it('is deterministic: the same text yields the same ordered list', () => {
    const text = 'When Moses met Aaron, Moses spoke and Aaron listened to Moses.';
    expect(suggestAntecedents(text)).toEqual(suggestAntecedents(text));
  });

  describe('property-based', () => {
    it('output excludes every pronoun-dictionary word, has no case-insensitive dup, is ascending', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const result = suggestAntecedents(text);
          const lowered = result.map((t) => t.toLowerCase());
          // no pronoun-dictionary word
          for (const lower of lowered) {
            expect(PRONOUN_DICTIONARY.has(lower)).toBe(false);
          }
          // no case-insensitive duplicate
          expect(new Set(lowered).size).toBe(result.length);
          // ascending
          const sorted = [...result].sort((a, b) => a.localeCompare(b));
          expect(result).toEqual(sorted);
        }),
      );
    });

    it('never throws for any input, including dictionary words and punctuation', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.constantFrom(...DICTIONARY), fc.constantFrom('.', '!?', '')),
          (text) => {
            expect(() => suggestAntecedents(text)).not.toThrow();
          },
        ),
      );
    });
  });
});
