/**
 * Pure text helpers for the Memorize the Scroll companion. No Angular, no AWS, no AI — just offset
 * chunking of the student's own scroll text and the client-side transforms the drill modes render.
 * Kept separate from the component so the interesting logic is unit-tested in isolation.
 */

import { MemorizationChunk, OutlineParagraph } from '../models';

/** Max length of a chunk's verseRef label. Mirrors the server cap. */
export const VERSE_REF_MAX = 50;
/** Max number of chunks per study. Mirrors the server cap. */
export const CHUNKS_MAX = 2000;
/** Default verses-per-chunk for the by-verses seed. */
export const DEFAULT_VERSES_PER_CHUNK = 5;
/** Bounds for the by-verses chunk size. */
export const VERSES_PER_CHUNK_MIN = 1;
export const VERSES_PER_CHUNK_MAX = 50;

/**
 * A verse marker anywhere in the scroll text — a number or chapter:verse at a token boundary,
 * e.g. "7" or "2:7". The scroll keeps these (de-emphasized) as reference anchors, so they are the
 * boundaries the by-verses seed walks. Global + multiline; we scan the WHOLE text, not just
 * paragraph starts. The leading boundary is a start-of-string / whitespace lookbehind substitute:
 * we require the marker to be preceded by start-of-line or whitespace and followed by whitespace,
 * so digits embedded in a word (e.g. "Psalm119") are not mistaken for markers.
 */
const VERSE_MARKER_SCAN = /(?:^|\s)(\d+(?::\d+)?)(?=\s)/gm;

/** One located verse marker: its label and the offset where its VERSE TEXT begins (after it). */
interface LocatedMarker {
  ref: string; // the marker label, e.g. "5" or "2:7"
  textStart: number; // offset in scrollText where this verse's text begins (just past the marker)
}

/** Find every verse marker in the scroll, in order. Empty when the scroll carries no markers. */
export function findVerseMarkers(scrollText: string): LocatedMarker[] {
  const markers: LocatedMarker[] = [];
  const re = new RegExp(VERSE_MARKER_SCAN); // fresh lastIndex per call
  let m: RegExpExecArray | null;
  while ((m = re.exec(scrollText)) !== null) {
    const ref = m[1];
    // The verse text starts right after the matched marker token (m[0] may include a leading space).
    const markerEnd = m.index + m[0].length;
    markers.push({ ref, textStart: markerEnd });
  }
  return markers;
}

/** Trim [from,to) to its first/last non-whitespace char so slicing reproduces the text exactly. */
function trimRange(scrollText: string, from: number, to: number): { start: number; end: number } {
  const raw = scrollText.slice(from, to);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  return { start: from + leading, end: to - trailing };
}

/** Compose a chunk label spanning first→last ref, e.g. "2:1-5" or "3" (single), capped. */
function spanRef(first: string, last: string): string {
  const label = first === last ? first : `${first}-${last}`;
  return label.slice(0, VERSE_REF_MAX);
}

/**
 * Seed chunks by grouping every N verse markers into one chunk (the student's "learn N verses at a
 * time" workflow). Walks the scroll's kept verse markers, slices from each group's first marker to
 * just before the next group's first marker, and labels the chunk with the spanning ref (e.g.
 * "2:1-5"). Any preamble before the first marker is folded into the first chunk so no text is lost.
 *
 * Returns [] when the scroll carries NO verse markers — the caller surfaces that so the student can
 * add markers or use the Step 8 seed instead. There is no blank-line fallback by design.
 */
export function seedByVerses(scrollText: string, versesPerChunk: number): MemorizationChunk[] {
  // Use the default only when the input is not a finite number; otherwise clamp the given value so
  // that e.g. 0 floors to the MIN (not the default) and 999 caps to the MAX.
  const requested = Number.isFinite(versesPerChunk) ? versesPerChunk : DEFAULT_VERSES_PER_CHUNK;
  const n = Math.max(VERSES_PER_CHUNK_MIN, Math.min(VERSES_PER_CHUNK_MAX, Math.floor(requested)));
  const markers = findVerseMarkers(scrollText);
  if (markers.length === 0) return [];

  const chunks: MemorizationChunk[] = [];
  for (let i = 0; i < markers.length; i += n) {
    const group = markers.slice(i, i + n);
    // The chunk's text runs from this group's FIRST marker to the next group's first marker (or EOT).
    // Fold any preamble before the very first marker into chunk 0 so nothing is dropped.
    const rawStart = i === 0 ? 0 : markerStartOf(scrollText, group[0]);
    const nextGroupFirst = markers[i + n];
    const rawEnd = nextGroupFirst ? markerStartOf(scrollText, nextGroupFirst) : scrollText.length;
    const { start, end } = trimRange(scrollText, rawStart, rawEnd);
    if (end <= start) continue;
    chunks.push({
      start,
      end,
      verseRef: spanRef(group[0].ref, group[group.length - 1].ref),
      state: 'new',
    });
  }
  return chunks;
}

/**
 * Offset in scrollText where a marker's own token begins (the marker label + its text together).
 * `textStart` points just past the label; back up over the label (and any single leading space)
 * so the chunk includes the de-emphasized marker itself, matching how the scroll reads.
 */
function markerStartOf(scrollText: string, marker: LocatedMarker): number {
  // textStart is just past the label; the label is marker.ref with an optional single space before.
  let i = marker.textStart - marker.ref.length;
  if (i > 0 && /\s/.test(scrollText[i - 1])) i -= 1;
  return Math.max(0, i);
}

/**
 * Seed one chunk per Step 8 (Outline) paragraph. Each paragraph carries a startRef/endRef; we
 * locate those marker strings in the scroll text to bound the chunk, and label it with the
 * paragraph's own ref span. Paragraphs are stored in reading order, so chunks come out ordered.
 *
 * A paragraph whose startRef cannot be located in the text (the student typed a ref that is not a
 * literal marker) is skipped and reported via `unmapped` so the view can flag it — never guessed.
 * Returns [] (with every index unmapped) when the outline has no locatable paragraphs.
 */
export function seedFromParagraphs(
  scrollText: string,
  paragraphs: readonly OutlineParagraph[],
): { chunks: MemorizationChunk[]; unmapped: number[] } {
  const markers = findVerseMarkers(scrollText);
  const byRef = new Map<string, LocatedMarker>();
  for (const mk of markers) if (!byRef.has(mk.ref)) byRef.set(mk.ref, mk);

  const chunks: MemorizationChunk[] = [];
  const unmapped: number[] = [];

  paragraphs.forEach((p, idx) => {
    const startMarker = p.startRef ? byRef.get(p.startRef.trim()) : undefined;
    if (!startMarker) {
      unmapped.push(idx);
      return;
    }
    const rawStart = markerStartOf(scrollText, startMarker);
    // End = the marker AFTER this paragraph's endRef (so the end verse is included), else EOT.
    const endMarker = p.endRef ? byRef.get(p.endRef.trim()) : startMarker;
    const after = nextMarkerAfter(markers, endMarker ?? startMarker);
    const rawEnd = after ? markerStartOf(scrollText, after) : scrollText.length;
    const { start, end } = trimRange(scrollText, rawStart, Math.max(rawEnd, rawStart));
    if (end <= start) {
      unmapped.push(idx);
      return;
    }
    const first = p.startRef.trim();
    const last = (p.endRef || p.startRef).trim();
    chunks.push({ start, end, verseRef: spanRef(first, last), state: 'new' });
  });

  return { chunks, unmapped };
}

/** The first marker whose textStart is strictly past the given marker's textStart, or undefined. */
function nextMarkerAfter(
  markers: readonly LocatedMarker[],
  marker: LocatedMarker,
): LocatedMarker | undefined {
  return markers.find((mk) => mk.textStart > marker.textStart);
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
