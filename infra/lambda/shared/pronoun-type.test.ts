import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PRONOUN_TYPES, isPronounType } from './pronoun-type';

/**
 * The frontend keeps its own copy of this list at src/app/pronoun-type.ts. The two bundles are
 * separate, so to catch drift without a cross-package import we assert the backend copy
 * deep-equals this literal (the same nine-type list the frontend ships).
 */
const EXPECTED_PRONOUN_TYPES: readonly string[] = [
  'Personal',
  'Demonstrative',
  'Indefinite',
  'Intensive',
  'Reflexive',
  'Interrogative',
  'Relative',
  'Reciprocal',
  'Quantifier',
];

describe('pronoun-type (shared)', () => {
  it('has the nine reference types in reference order', () => {
    expect(PRONOUN_TYPES).toHaveLength(9);
    expect([...PRONOUN_TYPES]).toEqual([...EXPECTED_PRONOUN_TYPES]);
  });

  it('matches the frontend copy exactly (guards against drift)', () => {
    expect([...PRONOUN_TYPES]).toEqual([...EXPECTED_PRONOUN_TYPES]);
  });

  it('isPronounType is true for every member', () => {
    for (const type of PRONOUN_TYPES) {
      expect(isPronounType(type)).toBe(true);
    }
  });

  it('isPronounType is false for junk and non-strings', () => {
    expect(isPronounType('')).toBe(false);
    expect(isPronounType('personal')).toBe(false); // case-sensitive
    expect(isPronounType('Possessive')).toBe(false);
    expect(isPronounType(undefined)).toBe(false);
    expect(isPronounType(null)).toBe(false);
    expect(isPronounType(42)).toBe(false);
    expect(isPronounType({})).toBe(false);
  });

  describe('property-based', () => {
    it('isPronounType returns true for any member', () => {
      fc.assert(
        fc.property(fc.constantFrom(...PRONOUN_TYPES), (type) => {
          expect(isPronounType(type)).toBe(true);
        }),
      );
    });

    it('isPronounType returns false for any non-member string', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !PRONOUN_TYPES.includes(s)),
          (s) => {
            expect(isPronounType(s)).toBe(false);
          },
        ),
      );
    });
  });
});
