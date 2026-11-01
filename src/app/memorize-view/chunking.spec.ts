import { describe, it, expect } from 'vitest';
import {
  seedByVerses,
  seedFromParagraphs,
  findVerseMarkers,
  chunkText,
  chunkOutOfRange,
  firstLetters,
  blankEveryNth,
  blankKeyWords,
  clozeMatches,
} from './chunking';
import { OutlineParagraph } from '../models';

const para = (startRef: string, endRef = startRef): OutlineParagraph => ({
  startRef,
  endRef,
  mainIdea: 'idea',
  notes: '',
});

describe('chunking helpers', () => {
  describe('findVerseMarkers', () => {
    it('finds standalone and chapter:verse markers in order', () => {
      const text = '1 In the beginning 2 and also 2:7 nested here';
      expect(findVerseMarkers(text).map((m) => m.ref)).toEqual(['1', '2', '2:7']);
    });

    it('ignores digits embedded in words', () => {
      const text = 'Psalm119 is long but 3 stands alone';
      expect(findVerseMarkers(text).map((m) => m.ref)).toEqual(['3']);
    });

    it('returns [] for text with no markers', () => {
      expect(findVerseMarkers('no numbers here at all')).toEqual([]);
    });
  });

  describe('seedByVerses', () => {
    it('groups every N verse markers into one ordered, non-overlapping chunk', () => {
      const text = '1 alpha 2 bravo 3 charlie 4 delta 5 echo 6 foxtrot';
      const chunks = seedByVerses(text, 2);
      expect(chunks.length).toBe(3);
      expect(chunks.map((c) => c.verseRef)).toEqual(['1-2', '3-4', '5-6']);
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].start).toBeGreaterThanOrEqual(chunks[i - 1].end);
      }
      // slicing reproduces each group's text (markers included)
      expect(chunkText(text, chunks[0])).toBe('1 alpha 2 bravo');
      expect(chunks.every((c) => c.state === 'new')).toBe(true);
    });

    it('labels a single-verse chunk without a range', () => {
      const text = '1 alpha 2 bravo 3 charlie';
      const chunks = seedByVerses(text, 1);
      expect(chunks.map((c) => c.verseRef)).toEqual(['1', '2', '3']);
    });

    it('folds preamble before the first marker into chunk 0', () => {
      const text = 'A title line 1 alpha 2 bravo';
      const chunks = seedByVerses(text, 5);
      expect(chunks.length).toBe(1);
      expect(chunkText(text, chunks[0])).toBe('A title line 1 alpha 2 bravo');
    });

    it('returns [] when the scroll carries no verse markers', () => {
      expect(seedByVerses('just prose with no markers', 5)).toEqual([]);
    });

    it('clamps the verse count into [1,50]', () => {
      const text = '1 a 2 b 3 c';
      expect(seedByVerses(text, 0).length).toBe(3); // 0 → 1 verse per chunk
      expect(seedByVerses(text, 999).length).toBe(1); // 999 → capped, all in one
    });
  });

  describe('seedFromParagraphs', () => {
    it('maps each paragraph startRef/endRef to an offset chunk', () => {
      const text = '1 alpha 2 bravo 3 charlie 4 delta';
      const { chunks, unmapped } = seedFromParagraphs(text, [para('1', '2'), para('3', '4')]);
      expect(unmapped).toEqual([]);
      expect(chunks.map((c) => c.verseRef)).toEqual(['1-2', '3-4']);
      expect(chunkText(text, chunks[0])).toBe('1 alpha 2 bravo');
      expect(chunkText(text, chunks[1])).toBe('3 charlie 4 delta');
    });

    it('reports a paragraph whose ref is not found in the text as unmapped', () => {
      const text = '1 alpha 2 bravo';
      const { chunks, unmapped } = seedFromParagraphs(text, [para('1'), para('9:9')]);
      expect(chunks.map((c) => c.verseRef)).toEqual(['1']);
      expect(unmapped).toEqual([1]);
    });

    it('handles chapter:verse refs', () => {
      const text = '2:1 alpha 2:2 bravo 2:3 charlie';
      const { chunks } = seedFromParagraphs(text, [para('2:1', '2:2'), para('2:3')]);
      expect(chunks.map((c) => c.verseRef)).toEqual(['2:1-2:2', '2:3']);
    });

    it('returns [] with all unmapped when no paragraph ref is locatable', () => {
      const { chunks, unmapped } = seedFromParagraphs('1 alpha', [para('5'), para('6')]);
      expect(chunks).toEqual([]);
      expect(unmapped).toEqual([0, 1]);
    });
  });

  describe('chunkText and chunkOutOfRange', () => {
    it('clamps a stale out-of-range chunk instead of throwing', () => {
      const text = 'short';
      expect(chunkText(text, { start: 0, end: 999 })).toBe('short');
      expect(chunkText(text, { start: 100, end: 200 })).toBe('');
      expect(chunkOutOfRange(text, { start: 0, end: 999 })).toBe(true);
      expect(chunkOutOfRange(text, { start: 0, end: 5 })).toBe(false);
    });
  });

  describe('firstLetters', () => {
    it('reduces each word to its first letter followed by blanks', () => {
      expect(firstLetters('Jesus wept today')).toBe('J____ w___ t____');
    });

    it('leaves punctuation and spacing intact', () => {
      expect(firstLetters('Go, and sin no more.')).toBe('G_, a__ s__ n_ m___.');
    });
  });

  describe('blankEveryNth', () => {
    it('blanks every Nth word, leaving non-word tokens shown', () => {
      const tokens = blankEveryNth('one two three four five six', 3);
      const blanked = tokens.filter((t) => t.blank).map((t) => t.text);
      expect(blanked).toEqual(['three', 'six']);
      // spaces are never blanked
      expect(tokens.filter((t) => t.text.trim() === '').every((t) => !t.blank)).toBe(true);
    });

    it('treats n < 1 as 1 (blank every word)', () => {
      const tokens = blankEveryNth('a b c', 0);
      expect(tokens.filter((t) => /\w/.test(t.text)).every((t) => t.blank)).toBe(true);
    });
  });

  describe('blankKeyWords', () => {
    it('blanks only the given key words, case-insensitively', () => {
      const tokens = blankKeyWords('God loves the world and God saves', ['god', 'world']);
      const blanked = tokens.filter((t) => t.blank).map((t) => t.text);
      expect(blanked).toEqual(['God', 'world', 'God']);
    });

    it('blanks nothing when no key words are given', () => {
      const tokens = blankKeyWords('nothing hidden here', []);
      expect(tokens.some((t) => t.blank)).toBe(false);
    });
  });

  describe('clozeMatches', () => {
    it('is case-insensitive and punctuation-tolerant', () => {
      expect(clozeMatches('jesus', 'Jesus')).toBe(true);
      expect(clozeMatches('  Jesus, ', 'jesus')).toBe(true);
      expect(clozeMatches('word.', 'word')).toBe(true);
    });

    it('rejects a genuine mismatch and an empty expected', () => {
      expect(clozeMatches('wept', 'rejoiced')).toBe(false);
      expect(clozeMatches('', '')).toBe(false);
      expect(clozeMatches('anything', '   ')).toBe(false);
    });
  });
});
