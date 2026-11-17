/**
 * Learn mode helpers: split a chunk into verses, and move a chunk's Learn progress forward.
 * Pure (no Angular, no I/O), unit-tested. Text only ever comes from the student's own scroll.
 */
import { MemorizationChunk, MemorizationChunkState, MemorizationLearnProgress } from '../models';
import { findVerseMarkers, VERSE_REF_MAX } from './chunking';

export interface LearnVerse {
  /** Reference label, e.g. "2:7". */
  label: string;
  /** The verse text with its leading verse number removed. */
  text: string;
}

/** Hard cap so a pathological scroll cannot produce more verses than the server accepts. */
export const LEARN_VERSES_MAX = 50;

/** Fresh progress for a chunk the student is starting. */
export function initialLearn(): MemorizationLearnProgress {
  return { unlocked: 1, learned: 0, done: false };
}

/** Split text on sentence ends (. ? ! optionally followed by a closing quote or bracket). */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]["'”’)\]]?)\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Split one chunk into verses. Uses the scroll's verse markers inside the chunk's range, with the
 * chapter carried forward so labels read "2:7". Any preamble before the first marker folds into the
 * first verse. A chunk with no markers is split into sentences ("Part 1", ...); one that yields a
 * single unit is returned as one verse labelled with the chunk's own reference.
 */
export function splitVerses(
  scrollText: string,
  chunk: Pick<MemorizationChunk, 'start' | 'end' | 'verseRef'>,
): LearnVerse[] {
  const start = Math.max(0, Math.min(chunk.start, scrollText.length));
  const end = Math.max(start, Math.min(chunk.end, scrollText.length));

  // A marker's label offset (chunks seeded by verses start exactly at the label).
  const labelAt = (m: { textStart: number; ref: string }): number => m.textStart - m.ref.length;
  const inRange = findVerseMarkers(scrollText).filter((m) => {
    const at = labelAt(m);
    return at >= start && at < end;
  });

  const verses: LearnVerse[] = [];
  if (inRange.length > 0) {
    inRange.forEach((m, i) => {
      const from = i === 0 ? start : labelAt(m);
      const to = i + 1 < inRange.length ? labelAt(inRange[i + 1]) : end;
      // Drop the marker token itself (exact offsets); keep any preamble before the first marker.
      const text = (scrollText.slice(from, labelAt(m)) + scrollText.slice(m.textStart, to))
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 0) verses.push({ label: m.fullRef, text });
    });
  } else {
    const sentences = splitSentences(scrollText.slice(start, end));
    if (sentences.length > 1) {
      sentences.forEach((text, i) => verses.push({ label: `Part ${i + 1}`, text }));
    } else if (sentences.length === 1) {
      verses.push({
        label: chunk.verseRef.slice(0, VERSE_REF_MAX) || 'Passage',
        text: sentences[0],
      });
    }
  }
  return verses.slice(0, LEARN_VERSES_MAX);
}

/** The first `upTo` verses joined in order: what the cumulative Recite stage hides and tests. */
export function rangeText(verses: readonly LearnVerse[], upTo: number): string {
  const n = Math.max(0, Math.min(Math.floor(upTo), verses.length));
  return verses
    .slice(0, n)
    .map((v) => v.text)
    .join(' ');
}

/** Bound stored progress to the chunk's current verse count (a re-seed can change the range). */
export function clampLearn(
  learn: MemorizationLearnProgress | undefined,
  verseCount: number,
): MemorizationLearnProgress {
  if (!learn || verseCount < 1) return initialLearn();
  const unlocked = Math.max(1, Math.min(learn.unlocked, verseCount));
  const learned = Math.max(0, Math.min(learn.learned, unlocked));
  // If the chunk grew past what was learned, it is no longer finished.
  const done = learn.done && learned === verseCount && unlocked === verseCount;
  return { unlocked, learned, done };
}

/** The student checked "Got it" on the newest unlocked verse. */
export function markLearned(learn: MemorizationLearnProgress): MemorizationLearnProgress {
  return { ...learn, learned: Math.max(learn.learned, learn.unlocked) };
}

/** "Not yet" on the newest verse: it is no longer counted as learned. */
export function unmarkLearned(learn: MemorizationLearnProgress): MemorizationLearnProgress {
  return { ...learn, learned: Math.min(learn.learned, learn.unlocked - 1), done: false };
}

/** Explicit unlock of the next verse. Never automatic; allowed without marking learned. */
export function unlockNext(
  learn: MemorizationLearnProgress,
  verseCount: number,
): MemorizationLearnProgress {
  if (learn.unlocked >= verseCount) return learn;
  return { ...learn, unlocked: learn.unlocked + 1 };
}

/** True when every verse is unlocked and learned, so the chunk grade can be offered. */
export function isReadyToGrade(learn: MemorizationLearnProgress, verseCount: number): boolean {
  return verseCount > 0 && learn.unlocked === verseCount && learn.learned === verseCount;
}

/** The chunk was graded: Learn is finished for it. */
export function markDone(learn: MemorizationLearnProgress): MemorizationLearnProgress {
  return { ...learn, done: true };
}

/**
 * Which chunk to learn next. An in-progress chunk (has Learn progress, not done) wins; otherwise the
 * first chunk with no finished Learn run whose derived state is still new or learning. -1 if none.
 */
export function nextChunkToLearn(
  chunks: readonly Pick<MemorizationChunk, 'learn'>[],
  states: readonly MemorizationChunkState[],
): number {
  const inProgress = chunks.findIndex((c) => c.learn !== undefined && !c.learn.done);
  if (inProgress >= 0) return inProgress;
  return chunks.findIndex(
    (c, i) => !c.learn?.done && (states[i] === 'new' || states[i] === 'learning'),
  );
}
