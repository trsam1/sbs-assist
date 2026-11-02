/**
 * Pure SM-2 (SuperMemo 2) spaced-repetition helpers for the Memorize the Scroll companion.
 * No Angular, no AWS, no AI, and NO baked-in clock — `today` is always passed in — so every
 * function is deterministic and unit-tested in isolation, exactly like `chunking.ts`.
 *
 * The scheduling fields live additively on each MemorizationChunk; this module reads them
 * (defaulting absent fields to "never reviewed → due now, ease 2.5") and, given a graded recall,
 * computes the next schedule. The learned-`state` ladder is a SEPARATE axis and is never touched
 * here — grading updates the schedule only.
 */

/** SM-2 scheduling fields on a chunk (all optional on the persisted model). */
export interface Schedule {
  easeFactor: number; // >= 1.3, default 2.5
  intervalDays: number; // >= 0
  repetitions: number; // >= 0 integer
  dueDate: string; // ISO date ('' = due now / never reviewed)
  lastReviewed: string; // ISO date ('' = never)
}

/** The three-button grade plus the could-not-recall "Again". */
export type Grade = 'again' | 'hard' | 'good' | 'easy'; // → quality 2 / 3 / 4 / 5

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;

/** Map the UI grade to an SM-2 quality score (0..5). Again is a miss (q < 3). */
const GRADE_QUALITY: Record<Grade, number> = {
  again: 2,
  hard: 3,
  good: 4,
  easy: 5,
};

/** The subset of a chunk this module reads — the optional scheduling fields. */
export interface SchedulePartial {
  easeFactor?: number;
  intervalDays?: number;
  repetitions?: number;
  dueDate?: string;
  lastReviewed?: string;
}

/** Format a Date as a local date-only ISO string (YYYY-MM-DD), no time-of-day, no timezone shift. */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse the date-only part of an ISO string to a local midnight Date; null when empty/invalid. */
function parseIsoDateOnly(iso: string): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local midnight of the given day (strips time-of-day for date-only comparisons). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Read a chunk's schedule, defaulting absent fields to "never reviewed → due now". */
export function readSchedule(chunk: SchedulePartial): Schedule {
  const easeRaw = typeof chunk.easeFactor === 'number' ? chunk.easeFactor : DEFAULT_EASE;
  return {
    easeFactor: Math.max(MIN_EASE, easeRaw),
    intervalDays:
      typeof chunk.intervalDays === 'number' && chunk.intervalDays >= 0
        ? Math.floor(chunk.intervalDays)
        : 0,
    repetitions:
      typeof chunk.repetitions === 'number' && chunk.repetitions >= 0
        ? Math.floor(chunk.repetitions)
        : 0,
    dueDate: chunk.dueDate ?? '',
    lastReviewed: chunk.lastReviewed ?? '',
  };
}

/**
 * True when this schedule is due on `today` (date-only): never reviewed (no dueDate), or
 * dueDate <= today. Time-of-day is ignored on both sides.
 */
export function isDue(s: Schedule, today: Date): boolean {
  const due = parseIsoDateOnly(s.dueDate);
  if (!due) return true; // never reviewed → due now
  return startOfDay(due).getTime() <= startOfDay(today).getTime();
}

/** Number of whole days from today until due (negative = overdue, 0 = today). */
export function daysUntilDue(s: Schedule, today: Date): number {
  const due = parseIsoDateOnly(s.dueDate);
  if (!due) return 0; // never reviewed → due today
  const ms = startOfDay(due).getTime() - startOfDay(today).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Apply SM-2 for a graded recall, returning the NEXT schedule (pure; `today` injected).
 *
 *   q < 3 (miss):  repetitions → 0,  intervalDays → 1
 *   q >= 3 (pass): repetitions += 1, intervalDays → 1 (1st) / 6 (2nd) / round(prev × ease) (else)
 *   always:        easeFactor → max(1.3, ease + (0.1 − (5−q)×(0.08 + (5−q)×0.02)))
 *   dueDate = today + intervalDays days;  lastReviewed = today
 */
export function applyGrade(s: Schedule, grade: Grade, today: Date): Schedule {
  const q = GRADE_QUALITY[grade];
  const prior = readSchedule(s); // defend against partial input

  let repetitions: number;
  let intervalDays: number;
  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions = prior.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(prior.intervalDays * prior.easeFactor));
  }

  const easeFactor = Math.max(
    MIN_EASE,
    prior.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );

  const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + intervalDays);

  return {
    easeFactor,
    intervalDays,
    repetitions,
    dueDate: toLocalIsoDate(next),
    lastReviewed: toLocalIsoDate(today),
  };
}

/** Human label for the next-due date, e.g. "due today" / "overdue" / "due in 6 days". */
export function dueLabel(s: Schedule, today: Date): string {
  if (!s.dueDate) return 'due today';
  const days = daysUntilDue(s, today);
  if (days < 0) return `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}
