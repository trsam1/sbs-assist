import { STOP_WORDS, SIGNAL_PHRASES, type MarkerKind } from './structure-wordlists';

/** A distinct word found in the scroll text, with its whole-word occurrence count. */
export interface WordCount {
  /** The canonical lower-cased form. */
  word: string;
  /** Whole-word occurrences in the text, always >= 1. */
  count: number;
}

/** A suggested structural marker found in the scroll text, in reading order. */
export interface MarkerCandidate {
  /** The marker kind the matched signal phrase suggests. */
  kind: MarkerKind;
  /** The original-cased phrase as it appears in the text. */
  phrase: string;
  /** Zero-based character offset of the match's first character in the text. */
  start: number;
}

/**
 * Matches a maximal run of ASCII letters. Anything else (whitespace, punctuation, digits, and the
 * apostrophe) is a separator, so a contraction splits into its letter-runs and each run is counted
 * independently. Identical to the Step 6 pronoun tokeniser, so the two tools agree on a "word".
 */
const LETTER_RUN = /[A-Za-z]+/g;

/**
 * Distinct words in `text` with occurrence counts, sorted by count descending then word ascending.
 * When `stopWords` is true (the default), common function words in `STOP_WORDS` are filtered out so
 * the surfaced focus words are content words; pass `false` to count every word. Pure, O(n) over the
 * characters, never throws; `''` → `[]`.
 */
export function wordFrequency(text: string, stopWords = true): WordCount[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(LETTER_RUN)) {
    const word = match[0].toLowerCase();
    if (stopWords && STOP_WORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

/**
 * Candidate structural markers in `text`, one per in-text match of a `SIGNAL_PHRASES` entry,
 * ordered by `start` ascending (reading order). Matching is case-insensitive and whole-phrase; the
 * text is read as data only (HTML-significant characters are not interpreted). Candidates are
 * advisory — the caller decides which become saved markers. Pure, O(n·m) over the text and phrase
 * list, never throws; `''` → `[]`.
 */
export function suggestMarkers(text: string): MarkerCandidate[] {
  if (text.length === 0) {
    return [];
  }
  const lower = text.toLowerCase();
  const candidates: MarkerCandidate[] = [];
  for (const { phrase, kind } of SIGNAL_PHRASES) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(phrase, from);
      if (idx === -1) {
        break;
      }
      candidates.push({ kind, phrase: text.slice(idx, idx + phrase.length), start: idx });
      from = idx + phrase.length;
    }
  }
  return candidates.sort((a, b) => a.start - b.start);
}
