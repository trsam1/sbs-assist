import { describe, it, expect } from 'vitest';
import { INTERROGATION_CATEGORIES, SUGGESTED_TAGS, normalizeTags } from './interrogation-questions';

describe('interrogation-questions constants', () => {
  it('INTERROGATION_CATEGORIES is exactly the 5 Ws + H + other, no duplicates', () => {
    expect([...INTERROGATION_CATEGORIES]).toEqual([
      'who',
      'what',
      'when',
      'where',
      'why',
      'how',
      'other',
    ]);
    expect(new Set(INTERROGATION_CATEGORIES).size).toBe(INTERROGATION_CATEGORIES.length);
  });

  it('SUGGESTED_TAGS is non-empty, de-duplicated, and carries no empties', () => {
    expect(SUGGESTED_TAGS.length).toBeGreaterThan(0);
    expect(new Set(SUGGESTED_TAGS).size).toBe(SUGGESTED_TAGS.length);
    expect(SUGGESTED_TAGS.every((t) => t.trim().length > 0)).toBe(true);
  });

  describe('normalizeTags', () => {
    it('trims, lower-cases, drops blanks, de-duplicates, preserves order', () => {
      expect(normalizeTags(['  About-God ', 'command', 'about-god', '', '  ', 'Context'])).toEqual([
        'about-god',
        'command',
        'context',
      ]);
    });

    it('returns [] for an empty or all-blank input', () => {
      expect(normalizeTags([])).toEqual([]);
      expect(normalizeTags(['', '   '])).toEqual([]);
    });
  });
});
