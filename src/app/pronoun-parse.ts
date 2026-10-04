import { PRONOUN_DICTIONARY } from './pronoun-dictionary';

/** A distinct pronoun found in the scroll text, with its whole-word occurrence count. */
export interface PronounCount {
  /** The canonical lower-cased dictionary form. */
  word: string;
  /** Whole-word occurrences in the text, always >= 1. */
  count: number;
}

/** An ordered slice of the scroll text for highlighting: plain text or a matched pronoun. */
export type Segment = { kind: 'text'; value: string } | { kind: 'pronoun'; value: string }; // value is the original-cased matched token

/**
 * Matches a maximal run of ASCII letters. Anything else (whitespace, punctuation, digits, and
 * crucially the apostrophe) is a separator, so a contraction splits into its letter-runs and each
 * run is matched independently.
 */
const LETTER_RUN = /[A-Za-z]+/g;

/** True iff the token's letter-only, lower-cased form is in the pronoun dictionary. Pure. */
export function isPronoun(token: string): boolean {
  const match = token.match(/[A-Za-z]+/);
  if (!match) {
    return false;
  }
  return PRONOUN_DICTIONARY.has(match[0].toLowerCase());
}

/**
 * Distinct dictionary pronouns in `text` with occurrence counts, sorted by count descending then
 * word ascending. Pure, O(n) over the characters, never throws; `''` → `[]`.
 */
export function parsePronouns(text: string): PronounCount[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(LETTER_RUN)) {
    const word = match[0].toLowerCase();
    if (PRONOUN_DICTIONARY.has(word)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

/**
 * `text` split into ordered text/pronoun segments for highlighting. Concatenating every segment's
 * `value` reproduces the input exactly (original casing and all inter-token characters preserved).
 * Pure, O(n), never throws; `''` → `[]`.
 */
export function toHighlightSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(LETTER_RUN)) {
    const run = match[0];
    const start = match.index;
    if (!PRONOUN_DICTIONARY.has(run.toLowerCase())) {
      continue; // fold non-pronoun letter-runs into the surrounding text segment
    }
    if (start > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, start) });
    }
    segments.push({ kind: 'pronoun', value: run });
    lastIndex = start + run.length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}
