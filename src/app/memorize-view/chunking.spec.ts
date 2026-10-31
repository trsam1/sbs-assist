import { describe, it, expect } from 'vitest';
import {
  seedChunks,
  chunkText,
  chunkOutOfRange,
  firstLetters,
  blankEveryNth,
  blankKeyWords,
  clozeMatches,
} from './chunking';

describe('chunking helpers', () => {
  describe('seedChunks', () => {
    it('splits on blank lines into ordered, non-overlapping offset chunks', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird.';
      const chunks = seedChunks(text);
      expect(chunks.length).toBe(3);
      // ordered and non-overlapping
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].start).toBeGreaterThanOrEqual(chunks[i - 1].end);
      }
      // slicing reproduces each paragraph verbatim
      expect(chunkText(text, chunks[0])).toBe('First paragraph.');
      expect(chunkText(text, chunks[1])).toBe('Second paragraph.');
      expect(chunkText(text, chunks[2])).toBe('Third.');
      // all seeded as 'new'
      expect(chunks.every((c) => c.state === 'new')).toBe(true);
    });

    it('lifts a leading verse marker into the chunk verseRef label', () => {
      const text = '1 In the beginning.\n\n2 And the earth.\n\n2:7 A nested marker.';
      const chunks = seedChunks(text);
      expect(chunks.map((c) => c.verseRef)).toEqual(['1', '2', '2:7']);
    });

    it('seeds a text with no blank lines as a single chunk', () => {
      const text = 'One continuous paragraph with no breaks at all.';
      const chunks = seedChunks(text);
      expect(chunks.length).toBe(1);
      expect(chunkText(text, chunks[0])).toBe(text);
      expect(chunks[0].verseRef).toBe('');
    });

    it('returns no chunks for empty text', () => {
      expect(seedChunks('')).toEqual([]);
      expect(seedChunks('\n\n   \n\n')).toEqual([]);
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
