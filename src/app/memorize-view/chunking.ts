/**
 * Pure text helpers for the Memorize the Scroll companion. No Angular, no AWS, no AI — just offset
 * chunking of the student's own scroll text and the client-side transforms the drill modes render.
 * Kept separate from the component so the interesting logic is unit-tested in isolation.
 */

import { MemorizationChunk } from '../models';

/** Max length of a chunk's verseRef label. Mirrors the server cap. */
export const VERSE_REF_MAX = 50;
/** Max number of chunks per study. Mirrors the server cap. */
export const CHUNKS_MAX = 2000;

/** Leading verse marker at the start of a paragraph, e.g. "7 " or "2:7 ". Captured as a label. */
const LEADING_VERSE_MARKER = /^\s*(\d+(?::\d+)?)\s+/;

/**
 * Seed a best-guess chunking of scroll text. Splits on blank-line (paragraph) boundaries, and where
 * a paragraph opens with a leading verse marker lifts that number into the chunk's `verseRef`
 * label. Returns contiguous, ordered, non-overlapping offset chunks (offsets into the ORIGINAL
 * text, so slicing reproduces the paragraph verbatim). A text with no blank lines seeds as one
 * chunk; the student then splits/merges as they see fit.
 */
export function seedChunks(scrollText: string): MemorizationChunk[] {
  const chunks: MemorizationChunk[] = [];
  // Split on blank-line delimiters (one or more newlines with only whitespace between), keeping
  // track of each segment's absolute offset. Trim each segment to its first/last non-whitespace
  // char so offsets bound the paragraph text exactly (slicing reproduces it verbatim).
  const delimiter = /\n[ \t]*\n\s*/g;
  let segStart = 0;
  let match: RegExpExecArray | null;

  const pushSegment = (from: number, to: number): void => {
    const raw = scrollText.slice(from, to);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = from + leading;
    const end = to - trailing;
    if (end <= start) return; // whitespace-only segment
    const markerMatch = LEADING_VERSE_MARKER.exec(scrollText.slice(start, end));
    const verseRef = markerMatch ? markerMatch[1].slice(0, VERSE_REF_MAX) : '';
    chunks.push({ start, end, verseRef, state: 'new' });
  };

  while ((match = delimiter.exec(scrollText)) !== null) {
    pushSegment(segStart, match.index);
    segStart = match.index + match[0].length;
  }
  pushSegment(segStart, scrollText.length);

  return chunks;
}

/** The text of a chunk, sliced from the scroll (clamped so stale offsets never throw). */
export function chunkText(scrollText: string, chunk: { start: number; end: number }): string {
  const start = Math.max(0, Math.min(chunk.start, scrollText.length));
  const end = Math.max(start, Math.min(chunk.end, scrollText.length));
  return scrollText.slice(start, end);
}

/** True when a chunk's offsets fall outside the current scroll text (flagged in the UI). */
export function chunkOutOfRange(
  scrollText: string,
  chunk: { start: number; end: number },
): boolean {
  return chunk.start < 0 || chunk.end > scrollText.length || chunk.start >= chunk.end;
}

/** Reduce each word to its first letter followed by blanks: "Jesus wept" → "J____ w___". */
export function firstLetters(text: string): string {
  return text.replace(/\p{L}[\p{L}'-]*/gu, (word) => word[0] + '_'.repeat(word.length - 1));
}

/** One token in a cloze rendering: either shown verbatim or a blank the student fills. */
export interface ClozeToken {
  text: string; // the original token text (the answer, for grading)
  blank: boolean; // true if hidden from the student
}

/** Split text into word / non-word tokens, preserving everything. */
function tokenize(text: string): string[] {
  return text.match(/\p{L}[\p{L}'-]*|[^\p{L}]+/gu) ?? [];
}

const isWord = (tok: string): boolean => /\p{L}/u.test(tok);

/** Blank every Nth WORD (n >= 1); non-word tokens (spaces, punctuation) are always shown. */
export function blankEveryNth(text: string, n: number): ClozeToken[] {
  const step = Math.max(1, Math.floor(n));
  let wordIndex = 0;
  return tokenize(text).map((tok) => {
    if (!isWord(tok)) return { text: tok, blank: false };
    wordIndex++;
    return { text: tok, blank: wordIndex % step === 0 };
  });
}

/** Blank only the given key words (case-insensitive, whole-word) wherever they appear. */
export function blankKeyWords(text: string, keyWords: readonly string[]): ClozeToken[] {
  const set = new Set(keyWords.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0));
  return tokenize(text).map((tok) => {
    if (!isWord(tok)) return { text: tok, blank: false };
    return { text: tok, blank: set.has(tok.toLowerCase()) };
  });
}

/**
 * Normalized compare for cloze self-check: case-insensitive, trims, and ignores surrounding
 * punctuation so "Jesus," matches "jesus". Runs entirely client-side — no AI, no server call.
 */
export function clozeMatches(typed: string, expected: string): boolean {
  const norm = (s: string): string =>
    s
      .trim()
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return norm(typed) === norm(expected) && norm(expected).length > 0;
}
