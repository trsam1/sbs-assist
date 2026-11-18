/**
 * Audio coaching plans for Memorize: phrase splitting, pauses, and the ordered steps a session runs.
 * Pure (no Angular, no browser APIs), unit-tested. Text only ever comes from the student's own scroll.
 */
import type { RecitationGradeResult } from '../models';

// --- preferences ----------------------------------------------------------------------------------

export interface CoachPrefs {
  /** Speech rate multiplier, 0.7 to 1.3. */
  rate: number;
  /** Silence allowed per word while the student repeats, in ms. */
  perWordMs: number;
  /** The shortest wait for any phrase, in ms. */
  floorMs: number;
  /** Silence that ends a recitation in Test coach, in ms. */
  silenceMs: number;
  /** How long Test coach waits after a result before the next card, in ms. */
  continueMs: number;
  /** Longest phrase, in words, before it is split. */
  maxPhraseWords: number;
  /** Play a short tone when recording starts. */
  tones: boolean;
  /** Installed voice name, or '' for the browser default. */
  voiceName: string;
}

export const DEFAULT_COACH_PREFS: CoachPrefs = {
  rate: 1,
  perWordMs: 700,
  floorMs: 2500,
  silenceMs: 2500,
  continueMs: 4000,
  maxPhraseWords: 8,
  tones: true,
  voiceName: '',
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Bring any stored value back into range, falling back to the default for anything that is not a number. */
export function normalizePrefs(raw: unknown): CoachPrefs {
  const d = DEFAULT_COACH_PREFS;
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  return {
    rate: num(o['rate'], d.rate, 0.7, 1.3),
    perWordMs: num(o['perWordMs'], d.perWordMs, 300, 2000),
    floorMs: num(o['floorMs'], d.floorMs, 1000, 8000),
    silenceMs: num(o['silenceMs'], d.silenceMs, 1200, 6000),
    continueMs: num(o['continueMs'], d.continueMs, 1000, 15000),
    maxPhraseWords: Math.round(num(o['maxPhraseWords'], d.maxPhraseWords, 3, 20)),
    tones: typeof o['tones'] === 'boolean' ? o['tones'] : d.tones,
    voiceName: typeof o['voiceName'] === 'string' ? o['voiceName'].slice(0, 200) : d.voiceName,
  };
}

// --- steps ----------------------------------------------------------------------------------------

/** What happened when the app listened for a recitation. */
export type RecordOutcome =
  | { kind: 'graded'; result: RecitationGradeResult }
  /** The student said nothing; no clip was graded. */
  | { kind: 'silent' }
  /** The grade service failed; the card needs a manual grade. */
  | { kind: 'failed' }
  /** No microphone, or permission was denied. */
  | { kind: 'unavailable' };

export type CoachStep =
  /** Say `text` aloud. `label` is the on-screen text for the same moment. */
  | { kind: 'speak'; text: string; label: string }
  /** Stay quiet for `ms` while the student speaks. */
  | { kind: 'wait'; ms: number; label: string }
  /** A short tone that marks "now". Skipped when the student turned tones off. */
  | { kind: 'tone'; label: string }
  /** Listen to the recitation, then grade it. */
  | { kind: 'record'; label: string };

const words = (text: string): string[] => text.split(/\s+/).filter((w) => w.length > 0);

/** The pause a student gets to repeat `text`. */
export function pauseMs(text: string, perWordMs: number, floorMs: number): number {
  return Math.max(floorMs, words(text).length * perWordMs);
}

// --- phrase splitting -----------------------------------------------------------------------------

/** A leading verse number such as "12 " or "12. " is never spoken. */
function stripVerseNumber(text: string): string {
  return text.replace(/^\s*\d+[.:)]?\s+(?=\D)/, '').trim();
}

/** Break a long piece in two near its middle, recursively, until every part fits. */
function splitLong(piece: string, maxWords: number): string[] {
  const w = words(piece);
  if (w.length <= maxWords) return [piece];
  const mid = Math.ceil(w.length / 2);
  return [
    ...splitLong(w.slice(0, mid).join(' '), maxWords),
    ...splitLong(w.slice(mid).join(' '), maxWords),
  ];
}

/**
 * Split a verse into phrases a student can repeat: break after , ; : . ? !, split anything longer than
 * `maxWords` near its middle, and fold pieces of fewer than three words into a neighbor so the student is
 * never asked to repeat "and he".
 */
export function splitPhrases(
  verseText: string,
  maxWords = DEFAULT_COACH_PREFS.maxPhraseWords,
): string[] {
  const text = stripVerseNumber(verseText.replace(/\s+/g, ' '));
  if (!text) return [];
  const rough = text
    .split(/(?<=[,;:.?!])\s+/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const sized = rough.flatMap((p) => splitLong(p, Math.max(3, maxWords)));

  const merged: string[] = [];
  for (const p of sized) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && (words(p).length < 3 || words(prev).length < 3)) {
      merged[merged.length - 1] = `${prev} ${p}`;
    } else {
      merged.push(p);
    }
  }
  // A short first piece with nothing before it has no earlier neighbor to join; fold it forward.
  if (merged.length > 1 && words(merged[0]).length < 3) {
    merged.splice(0, 2, `${merged[0]} ${merged[1]}`);
  }
  return merged;
}

// --- Learn coach ----------------------------------------------------------------------------------

/**
 * "Repeat after me" for one verse. Hears the whole verse, then each phrase with a pause to repeat it, then
 * the growing passage from the start, then the whole verse from memory. When earlier verses exist, finishes
 * with a pass over verses 1 through N together. Never grades anything.
 */
export function planLearnVerse(
  verseText: string,
  priorText: string | null,
  prefs: CoachPrefs,
  verseNumber = 1,
): CoachStep[] {
  const whole = stripVerseNumber(verseText.replace(/\s+/g, ' '));
  const phrases = splitPhrases(whole, prefs.maxPhraseWords);
  if (!whole) return [];

  const wait = (text: string, label: string): CoachStep => ({
    kind: 'wait',
    ms: pauseMs(text, prefs.perWordMs, prefs.floorMs),
    label,
  });
  const steps: CoachStep[] = [{ kind: 'speak', text: whole, label: 'Listen to the whole verse' }];

  phrases.forEach((phrase, i) => {
    const n = i + 1;
    steps.push(
      { kind: 'speak', text: 'Repeat after me.', label: `Phrase ${n} of ${phrases.length}` },
      { kind: 'speak', text: phrase, label: `Phrase ${n} of ${phrases.length}` },
      wait(phrase, `Say phrase ${n}`),
    );
    if (n > 1) {
      const together = phrases.slice(0, n).join(' ');
      steps.push(
        { kind: 'speak', text: 'Together.', label: `Phrases 1 to ${n}` },
        { kind: 'speak', text: together, label: `Phrases 1 to ${n}` },
        wait(together, `Say phrases 1 to ${n}`),
      );
    }
  });

  steps.push(
    { kind: 'speak', text: 'Now the whole verse, from memory.', label: 'The whole verse' },
    wait(whole, 'Say the whole verse'),
    { kind: 'speak', text: whole, label: 'Check yourself' },
  );

  if (priorText && priorText.trim()) {
    const all = `${priorText.trim()} ${whole}`;
    steps.push(
      {
        kind: 'speak',
        text: `Now verses one through ${verseNumber}, from memory.`,
        label: `Verses 1 to ${verseNumber}`,
      },
      wait(all, `Say verses 1 to ${verseNumber}`),
      { kind: 'speak', text: all, label: 'Check yourself' },
    );
  }
  return steps;
}

// --- Test coach -----------------------------------------------------------------------------------

/** Say the reference and "your turn", mark the moment with a tone, then listen. */
export function planTestPrompt(reference: string, prefs: CoachPrefs): CoachStep[] {
  const ref = reference.trim();
  const steps: CoachStep[] = [
    {
      kind: 'speak',
      text: ref ? `${ref}. Your turn.` : 'Your turn.',
      label: ref ? `${ref}: your turn` : 'Your turn',
    },
  ];
  if (prefs.tones) steps.push({ kind: 'tone', label: 'Listening' });
  steps.push({ kind: 'record', label: 'Listening' });
  return steps;
}

const GRADE_WORD: Record<RecitationGradeResult['grade'], string> = {
  again: 'Needs work',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

/** The short spoken result: grade, accuracy, and up to three missed words. */
export function resultSpeech(outcome: RecordOutcome, willRepeat: boolean): string {
  switch (outcome.kind) {
    case 'silent':
      return "I didn't hear anything.";
    case 'failed':
      return "I couldn't check that one. Moving on.";
    case 'unavailable':
      return 'I cannot use the microphone, so I will stop here.';
    case 'graded': {
      const r = outcome.result;
      if (r.degraded) {
        return `${GRADE_WORD[r.grade]}. I could not check the words fully, so this was scored by word match.${willRepeat ? ' Try again.' : ''}`;
      }
      const missed = r.missedWords.slice(0, 3);
      const extra = r.missedWords.length - missed.length;
      const parts = [`${GRADE_WORD[r.grade]}. ${Math.round(r.accuracyPct)} percent.`];
      if (missed.length > 0) {
        parts.push(`You missed: ${missed.join(', ')}${extra > 0 ? `, and ${extra} more` : ''}.`);
      }
      if (willRepeat) parts.push('Try again.');
      return parts.join(' ');
    }
  }
}
