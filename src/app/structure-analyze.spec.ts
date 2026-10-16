import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { STOP_WORDS, SIGNAL_PHRASES } from './structure-wordlists';
import { wordFrequency, suggestMarkers } from './structure-analyze';

/** Count all letter-run tokens (apostrophe-split) in the text. */
function countTokens(text: string): number {
  return (text.match(/[A-Za-z]+/g) ?? []).length;
}

describe('wordFrequency', () => {
  it('counts whole words case-insensitively and collapses case', () => {
    const result = wordFrequency('Grace Grace GRACE', false);
    expect(result).toEqual([{ word: 'grace', count: 3 }]);
  });

  it('splits on the apostrophe so a contraction yields its letter-runs', () => {
    // "it's" → "it" + "s"; with stop words off both are counted.
    const result = wordFrequency("it's", false);
    const words = result.map((r) => r.word).sort();
    expect(words).toEqual(['it', 's']);
  });

  it('does not match a word as a substring of a longer word', () => {
    const result = wordFrequency('within withhold', false);
    expect(result.map((r) => r.word).sort()).toEqual(['withhold', 'within']);
  });

  it('filters stop words by default and counts them when disabled', () => {
    const withFilter = wordFrequency('the holy the LORD the', true);
    expect(withFilter.find((r) => r.word === 'the')).toBeUndefined();
    expect(withFilter).toEqual([
      { word: 'holy', count: 1 },
      { word: 'lord', count: 1 },
    ]);

    const noFilter = wordFrequency('the holy the LORD the', false);
    expect(noFilter.find((r) => r.word === 'the')).toEqual({ word: 'the', count: 3 });
  });

  it('sorts by count descending then word ascending', () => {
    const result = wordFrequency('faith faith hope hope grace', false);
    expect(result).toEqual([
      { word: 'faith', count: 2 },
      { word: 'hope', count: 2 },
      { word: 'grace', count: 1 },
    ]);
  });

  it('returns [] for empty and whitespace-only input and never throws', () => {
    expect(wordFrequency('')).toEqual([]);
    expect(wordFrequency('   \n\t ')).toEqual([]);
    expect(() => wordFrequency('123 ... !!!')).not.toThrow();
    expect(wordFrequency('123 ... !!!')).toEqual([]);
  });

  it('conserves the token count when stop words are off (nothing dropped or double-counted)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const total = wordFrequency(text, false).reduce((sum, r) => sum + r.count, 0);
        expect(total).toBe(countTokens(text));
      }),
    );
  });

  it('produces a total deterministic order (count desc, then word asc)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = wordFrequency(text, false);
        for (let i = 1; i < result.length; i++) {
          const prev = result[i - 1];
          const cur = result[i];
          const ordered =
            prev.count > cur.count || (prev.count === cur.count && prev.word < cur.word);
          expect(ordered).toBe(true);
        }
      }),
    );
  });
});

describe('suggestMarkers', () => {
  it('finds a signal phrase case-insensitively with its kind and offset', () => {
    const text = 'Now concerning spiritual gifts, brethren, I would not have you ignorant.';
    const found = suggestMarkers(text);
    const nc = found.find((m) => m.phrase.toLowerCase() === 'now concerning');
    expect(nc).toBeDefined();
    expect(nc?.kind).toBe('transition');
    expect(nc?.start).toBe(0);
    expect(
      found.some((m) => m.phrase.toLowerCase() === 'brethren' && m.kind === 'direct-address'),
    ).toBe(true);
  });

  it('returns candidates in reading order by start offset', () => {
    const text = 'Finally brethren, therefore let us behold.';
    const found = suggestMarkers(text);
    const starts = found.map((m) => m.start);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });

  it('preserves original casing of the matched phrase and reads text as data', () => {
    const text = '<b>THEREFORE</b> & behold';
    const found = suggestMarkers(text);
    const tf = found.find((m) => m.phrase.toLowerCase() === 'therefore');
    expect(tf?.phrase).toBe('THEREFORE'); // original casing preserved from the text
    expect(() => suggestMarkers(text)).not.toThrow();
  });

  it('returns [] for text with no signal phrases and for empty input', () => {
    expect(suggestMarkers('a quiet verse with none of the markers')).toEqual([]);
    expect(suggestMarkers('')).toEqual([]);
  });
});

describe('structure word lists', () => {
  it('STOP_WORDS is non-empty and lower-cased', () => {
    expect(STOP_WORDS.size).toBeGreaterThan(0);
    for (const w of STOP_WORDS) {
      expect(w).toBe(w.toLowerCase());
    }
  });

  it('SIGNAL_PHRASES is non-empty, lower-cased, and every entry has a valid kind', () => {
    const kinds = new Set(['transition', 'direct-address', 'declarative', 'command', 'other']);
    expect(SIGNAL_PHRASES.length).toBeGreaterThan(0);
    for (const s of SIGNAL_PHRASES) {
      expect(s.phrase).toBe(s.phrase.toLowerCase());
      expect(kinds.has(s.kind)).toBe(true);
    }
  });
});
