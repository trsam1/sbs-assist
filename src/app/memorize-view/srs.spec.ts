import { describe, it, expect } from 'vitest';
import {
  readSchedule,
  isDue,
  applyGrade,
  dueLabel,
  daysUntilDue,
  toLocalIsoDate,
  DEFAULT_EASE,
  MIN_EASE,
  Schedule,
  SchedulePartial,
} from './srs';

/** A fixed, timezone-agnostic "today" (local midnight) for deterministic date math. */
const TODAY = new Date(2026, 10, 2); // 2026-11-02, local
const iso = (d: Date): string => toLocalIsoDate(d);
const plusDays = (n: number): Date => new Date(2026, 10, 2 + n);

describe('srs.readSchedule', () => {
  it('defaults absent fields to "never reviewed → due now, ease 2.5"', () => {
    const s = readSchedule({});
    expect(s.easeFactor).toBe(DEFAULT_EASE);
    expect(s.intervalDays).toBe(0);
    expect(s.repetitions).toBe(0);
    expect(s.dueDate).toBe('');
    expect(s.lastReviewed).toBe('');
  });

  it('floors a stored ease below the minimum', () => {
    expect(readSchedule({ easeFactor: 1.0 }).easeFactor).toBe(MIN_EASE);
  });

  it('passes through valid stored fields', () => {
    const partial: SchedulePartial = {
      easeFactor: 2.36,
      intervalDays: 6,
      repetitions: 2,
      dueDate: '2026-11-08',
      lastReviewed: '2026-11-02',
    };
    const s = readSchedule(partial);
    expect(s).toEqual({
      easeFactor: 2.36,
      intervalDays: 6,
      repetitions: 2,
      dueDate: '2026-11-08',
      lastReviewed: '2026-11-02',
    });
  });

  it('coerces negative/non-integer interval and reps defensively', () => {
    const s = readSchedule({ intervalDays: -5, repetitions: 2.9 });
    expect(s.intervalDays).toBe(0);
    expect(s.repetitions).toBe(2);
  });
});

describe('srs.isDue', () => {
  it('is true for a never-reviewed chunk (no dueDate)', () => {
    expect(isDue(readSchedule({}), TODAY)).toBe(true);
  });

  it('is true when dueDate is today or earlier (date-only)', () => {
    expect(isDue(readSchedule({ dueDate: iso(TODAY) }), TODAY)).toBe(true);
    expect(isDue(readSchedule({ dueDate: iso(plusDays(-3)) }), TODAY)).toBe(true);
  });

  it('is false when dueDate is in the future', () => {
    expect(isDue(readSchedule({ dueDate: iso(plusDays(6)) }), TODAY)).toBe(false);
  });

  it('ignores time-of-day — a same-day full timestamp is still due today', () => {
    expect(isDue(readSchedule({ dueDate: '2026-11-02T23:59:59Z' }), TODAY)).toBe(true);
  });
});

describe('srs.applyGrade — SM-2 recurrence', () => {
  it('first successful recall → interval 1, reps 1, dueDate today+1', () => {
    const next = applyGrade(readSchedule({}), 'good', TODAY);
    expect(next.repetitions).toBe(1);
    expect(next.intervalDays).toBe(1);
    expect(next.dueDate).toBe(iso(plusDays(1)));
    expect(next.lastReviewed).toBe(iso(TODAY));
  });

  it('second successful recall → interval 6', () => {
    const afterFirst = applyGrade(readSchedule({}), 'good', TODAY);
    const afterSecond = applyGrade(afterFirst, 'good', TODAY);
    expect(afterSecond.repetitions).toBe(2);
    expect(afterSecond.intervalDays).toBe(6);
    expect(afterSecond.dueDate).toBe(iso(plusDays(6)));
  });

  it('third+ successful recall → round(prev interval × ease)', () => {
    const s: Schedule = {
      easeFactor: 2.5,
      intervalDays: 6,
      repetitions: 2,
      dueDate: iso(TODAY),
      lastReviewed: '',
    };
    const next = applyGrade(s, 'good', TODAY);
    expect(next.repetitions).toBe(3);
    // 6 × (ease after a q=4 grade). ease stays ~2.5 for 'good' → round(6 × ~2.5) = 15
    expect(next.intervalDays).toBe(15);
    expect(next.dueDate).toBe(iso(plusDays(15)));
  });

  it('a miss (again) resets reps to 0 and interval to 1', () => {
    const solid: Schedule = {
      easeFactor: 2.6,
      intervalDays: 40,
      repetitions: 5,
      dueDate: iso(TODAY),
      lastReviewed: '',
    };
    const next = applyGrade(solid, 'again', TODAY);
    expect(next.repetitions).toBe(0);
    expect(next.intervalDays).toBe(1);
    expect(next.dueDate).toBe(iso(plusDays(1)));
    // ease still moves (down) on a miss and never drops below the floor
    expect(next.easeFactor).toBeGreaterThanOrEqual(MIN_EASE);
    expect(next.easeFactor).toBeLessThan(2.6);
  });

  it('Hard / Good / Easy produce increasing ease deltas (q 3/4/5)', () => {
    const base = readSchedule({ easeFactor: 2.5, repetitions: 1, intervalDays: 1 });
    const hard = applyGrade(base, 'hard', TODAY).easeFactor;
    const good = applyGrade(base, 'good', TODAY).easeFactor;
    const easy = applyGrade(base, 'easy', TODAY).easeFactor;
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThanOrEqual(easy);
    // 'hard' (q=3) drives ease down; 'easy' (q=5) nudges it up
    expect(hard).toBeLessThan(2.5);
    expect(easy).toBeGreaterThan(2.5);
  });

  it('ease never falls below the minimum even after repeated hard grades', () => {
    let s = readSchedule({ easeFactor: MIN_EASE });
    for (let i = 0; i < 10; i++) s = applyGrade(s, 'hard', TODAY);
    expect(s.easeFactor).toBeGreaterThanOrEqual(MIN_EASE);
  });

  it('interval is always a positive integer after a grade', () => {
    const s = applyGrade(
      readSchedule({ intervalDays: 3, repetitions: 4, easeFactor: 1.3 }),
      'good',
      TODAY,
    );
    expect(Number.isInteger(s.intervalDays)).toBe(true);
    expect(s.intervalDays).toBeGreaterThanOrEqual(1);
  });
});

describe('srs.daysUntilDue / dueLabel', () => {
  it('never-reviewed reads as due today', () => {
    const s = readSchedule({});
    expect(daysUntilDue(s, TODAY)).toBe(0);
    expect(dueLabel(s, TODAY)).toBe('due today');
  });

  it('labels future due dates', () => {
    expect(dueLabel(readSchedule({ dueDate: iso(plusDays(1)) }), TODAY)).toBe('due tomorrow');
    expect(dueLabel(readSchedule({ dueDate: iso(plusDays(6)) }), TODAY)).toBe('due in 6 days');
  });

  it('labels overdue chunks', () => {
    expect(dueLabel(readSchedule({ dueDate: iso(plusDays(-2)) }), TODAY)).toBe('overdue by 2 days');
    expect(dueLabel(readSchedule({ dueDate: iso(plusDays(-1)) }), TODAY)).toBe('overdue by 1 day');
  });
});
