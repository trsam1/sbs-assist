import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PRONOUN_DICTIONARY } from './pronoun-dictionary';
import {
  isPronoun,
  parsePronouns,
  parsePronounOccurrences,
  toHighlightSegments,
} from './pronoun-parse';

const DICTIONARY = [...PRONOUN_DICTIONARY];

/** Count letter-run tokens (apostrophe-split) whose lower-cased form is a dictionary pronoun. */
function countMatchedTokens(text: string): number {
  const runs = text.match(/[A-Za-z]+/g) ?? [];
  return runs.filter((r) => PRONOUN_DICTIONARY.has(r.toLowerCase())).length;
}

describe('isPronoun', () => {
  it('is true for every dictionary member in lower, upper, and mixed case', () => {
    for (const word of DICTIONARY) {
      expect(isPronoun(word)).toBe(true);
      expect(isPronoun(word.toUpperCase())).toBe(true);
      expect(isPronoun(word[0].toUpperCase() + word.slice(1))).toBe(true);
    }
  });

  it('is true for a dictionary member surrounded by punctuation', () => {
    expect(isPronoun('He,')).toBe(true);
    expect(isPronoun('(it)')).toBe(true);
    expect(isPronoun('"they"')).toBe(true);
  });

  it('is false for non-members and empty input', () => {
    expect(isPronoun('the')).toBe(false);
    expect(isPronoun('there')).toBe(false);
    expect(isPronoun('')).toBe(false);
    expect(isPronoun('!!!')).toBe(false);
  });

  describe('property-based', () => {
    it('is true for any member in any case surrounded by punctuation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...DICTIONARY),
          fc.constantFrom('', ',', '.', '(', ')', '"', ';', '!'),
          fc.constantFrom('', ',', '.', '(', ')', '"', ';', '!'),
          (word, left, right) => {
            const cased = word
              .split('')
              .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
              .join('');
            expect(isPronoun(left + cased + right)).toBe(true);
          },
        ),
      );
    });

    it('is false for any token whose letter-run is not in the dictionary', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => {
            const run = s.match(/[A-Za-z]+/);
            return !run || !PRONOUN_DICTIONARY.has(run[0].toLowerCase());
          }),
          (s) => {
            expect(isPronoun(s)).toBe(false);
          },
        ),
      );
    });
  });
});

describe('parsePronouns', () => {
  it('matches whole words only, never a substring of a longer word', () => {
    // "it" must not match inside "with"; "with" itself is not a pronoun.
    expect(parsePronouns('with within without')).toEqual([]);
  });

  it('splits on apostrophes and matches each letter-run (Req 1.4)', () => {
    expect(parsePronouns("it's")).toEqual([{ word: 'it', count: 1 }]);
    expect(parsePronouns("we're")).toEqual([{ word: 'we', count: 1 }]);
    expect(parsePronouns("its'")).toEqual([{ word: 'its', count: 1 }]);
  });

  it('counts case-insensitively, collapsing cases into one entry', () => {
    expect(parsePronouns('He saw him. HE left. he returned.')).toEqual([
      { word: 'he', count: 3 },
      { word: 'him', count: 1 },
    ]);
  });

  it('sorts by count descending then word ascending', () => {
    // they:3, we:2, i:2, he:1 → count desc, then alpha for the we/i tie.
    const result = parsePronouns('they they they we we I I he');
    expect(result).toEqual([
      { word: 'they', count: 3 },
      { word: 'i', count: 2 },
      { word: 'we', count: 2 },
      { word: 'he', count: 1 },
    ]);
  });

  it('returns an empty list for empty and whitespace-only input', () => {
    expect(parsePronouns('')).toEqual([]);
    expect(parsePronouns('   \n\t  ')).toEqual([]);
  });

  describe('property-based', () => {
    it('conserves counts: sum(counts) equals the number of matched letter-run tokens', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const total = parsePronouns(text).reduce((sum, p) => sum + p.count, 0);
          expect(total).toBe(countMatchedTokens(text));
        }),
      );
    });

    it('never throws and every count is >= 1', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const result = parsePronouns(text);
          for (const entry of result) {
            expect(entry.count).toBeGreaterThanOrEqual(1);
            expect(PRONOUN_DICTIONARY.has(entry.word)).toBe(true);
          }
        }),
      );
    });

    it('returns one entry per distinct matched pronoun', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const words = parsePronouns(text).map((p) => p.word);
          expect(new Set(words).size).toBe(words.length);
        }),
      );
    });
  });
});

describe('toHighlightSegments', () => {
  it('returns an empty list for empty input', () => {
    expect(toHighlightSegments('')).toEqual([]);
  });

  it('tags pronoun tokens and preserves original casing', () => {
    expect(toHighlightSegments('He went')).toEqual([
      { kind: 'pronoun', value: 'He' },
      { kind: 'text', value: ' went' },
    ]);
  });

  describe('property-based', () => {
    it('concatenating segment values reproduces the input exactly', () => {
      const sampleText = fc.oneof(
        fc.string(),
        fc.constantFrom(
          'He said <b>it</b> & they',
          'line one\nline two with it\n\nthey',
          '  (she) said: "they" & you! ',
          "it's we're its' <&>",
        ),
      );
      fc.assert(
        fc.property(sampleText, (text) => {
          const joined = toHighlightSegments(text)
            .map((s) => s.value)
            .join('');
          expect(joined).toBe(text);
        }),
      );
    });

    it('every pronoun segment is a dictionary member', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          for (const seg of toHighlightSegments(text)) {
            if (seg.kind === 'pronoun') {
              expect(PRONOUN_DICTIONARY.has(seg.value.toLowerCase())).toBe(true);
            }
          }
        }),
      );
    });
  });
});

describe('parsePronounOccurrences', () => {
  it('returns an empty list for empty and whitespace-only input', () => {
    expect(parsePronounOccurrences('')).toEqual([]);
    expect(parsePronounOccurrences('   \n\t  ')).toEqual([]);
  });

  it('returns one entry per in-text appearance in reading order, with offsets and casing', () => {
    // "He saw him. HE left." → he@0, him@7, HE@12
    expect(parsePronounOccurrences('He saw him. HE left.')).toEqual([
      { word: 'he', token: 'He', start: 0, occurrence: 0 },
      { word: 'him', token: 'him', start: 7, occurrence: 1 },
      { word: 'he', token: 'HE', start: 12, occurrence: 2 },
    ]);
  });

  it('is deterministic: the same text yields the same ordered list', () => {
    const text = 'They told them that she saw him and he saw her.';
    expect(parsePronounOccurrences(text)).toEqual(parsePronounOccurrences(text));
  });

  it('splits on apostrophes and keeps each matched letter-run as its own occurrence', () => {
    // "it's" → it@0; "we're" → we; apostrophe is a separator.
    const result = parsePronounOccurrences("it's we're");
    expect(result.map((o) => o.word)).toEqual(['it', 'we']);
    expect(result[0].start).toBe(0);
  });

  it('each start indexes the first character of a letter-run that isPronoun accepts', () => {
    const text = 'with him, within her';
    for (const occ of parsePronounOccurrences(text)) {
      // the run starting at `start` lower-cases to `word`
      const run = text.slice(occ.start).match(/^[A-Za-z]+/);
      expect(run).not.toBeNull();
      expect(run?.[0].toLowerCase()).toBe(occ.word);
      expect(isPronoun(run?.[0] ?? '')).toBe(true);
    }
  });

  describe('property-based', () => {
    it('occurrence is the 0-based reading-order ordinal and start is strictly increasing', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const list = parsePronounOccurrences(text);
          list.forEach((occ, i) => expect(occ.occurrence).toBe(i));
          for (let i = 1; i < list.length; i++) {
            expect(list[i].start).toBeGreaterThan(list[i - 1].start);
          }
        }),
      );
    });

    it('grouping by word and counting equals parsePronouns (same words, same counts)', () => {
      const sampleText = fc.oneof(
        fc.string(),
        fc.constantFrom(
          'He saw them, and they saw him.',
          "it's we're its'",
          'She told HER that THEY were with us.',
          'with within without',
        ),
      );
      fc.assert(
        fc.property(sampleText, (text) => {
          const counts = new Map<string, number>();
          for (const occ of parsePronounOccurrences(text)) {
            expect(PRONOUN_DICTIONARY.has(occ.word)).toBe(true);
            counts.set(occ.word, (counts.get(occ.word) ?? 0) + 1);
          }
          const grouped = [...counts.entries()]
            .map(([word, count]) => ({ word, count }))
            .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
          expect(grouped).toEqual(parsePronouns(text));
        }),
      );
    });

    it('never throws and every token lower-cases to its word', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          for (const occ of parsePronounOccurrences(text)) {
            expect(occ.token.toLowerCase()).toBe(occ.word);
          }
        }),
      );
    });
  });
});
