import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  PRONOUN_TYPES,
  PRONOUN_TYPE_HINTS,
  UNCLASSIFIED,
  isPronounType,
  toPronounType,
} from './pronoun-type';

/**
 * The backend keeps its own copy of this list at infra/lambda/shared/pronoun-type.ts. The two
 * bundles are separate, so to catch drift without a cross-package import we assert this list
 * deep-equals the same literal the backend ships (see shared/pronoun-type.test.ts).
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

describe('pronoun-type', () => {
  it('has the nine reference types in reference order (guards against drift)', () => {
    expect(PRONOUN_TYPES).toHaveLength(9);
    expect([...PRONOUN_TYPES]).toEqual(EXPECTED_PRONOUN_TYPES);
  });

  it('PRONOUN_TYPE_HINTS keys equal the type list exactly', () => {
    expect(Object.keys(PRONOUN_TYPE_HINTS)).toEqual([...PRONOUN_TYPES]);
  });

  it('every hint is non-empty copyright-free text', () => {
    for (const type of PRONOUN_TYPES) {
      expect(PRONOUN_TYPE_HINTS[type].length).toBeGreaterThan(0);
    }
  });

  it('isPronounType accepts every member', () => {
    for (const type of PRONOUN_TYPES) {
      expect(isPronounType(type)).toBe(true);
    }
  });

  it('isPronounType rejects non-members, the empty string, and non-strings', () => {
    expect(isPronounType('')).toBe(false);
    expect(isPronounType('personal')).toBe(false); // case-sensitive
    expect(isPronounType('Possessive')).toBe(false);
    expect(isPronounType(undefined)).toBe(false);
    expect(isPronounType(null)).toBe(false);
    expect(isPronounType(42)).toBe(false);
    expect(isPronounType({})).toBe(false);
  });

  it('toPronounType maps members to themselves and everything else to unclassified', () => {
    for (const type of PRONOUN_TYPES) {
      expect(toPronounType(type)).toBe(type);
    }
    expect(toPronounType('')).toBe(UNCLASSIFIED);
    expect(toPronounType('bogus')).toBe(UNCLASSIFIED);
    expect(toPronounType(undefined)).toBe(UNCLASSIFIED);
    expect(toPronounType(null)).toBe(UNCLASSIFIED);
    expect(toPronounType(123)).toBe(UNCLASSIFIED);
  });

  describe('property-based', () => {
    it('isPronounType returns true for any member', () => {
      fc.assert(
        fc.property(fc.constantFrom(...PRONOUN_TYPES), (type) => {
          expect(isPronounType(type)).toBe(true);
        }),
      );
    });

    it('toPronounType maps any non-member string to unclassified', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !(PRONOUN_TYPES as readonly string[]).includes(s)),
          (s) => {
            expect(toPronounType(s)).toBe(UNCLASSIFIED);
          },
        ),
      );
    });
  });
});
