import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { RecitationGradeResult } from '../models';
import { RecordOutcome } from './coach-plan';
import {
  COACH_PLATFORM,
  COACH_PREFS_KEY,
  MAX_ATTEMPTS_PER_CARD,
  MemorizeCoach,
} from './memorize-coach';
import { MemorizeStore } from './memorize-store';
import { MemorizeTest } from './memorize-test.service';

const graded = (grade: RecitationGradeResult['grade'], missed: string[] = []): RecordOutcome => ({
  kind: 'graded',
  result: { grade, reason: '', accuracyPct: 90, missedWords: missed, transcript: 'x' },
});

/** A stand-in for the page store with only what the coach reads and calls. */
function fakeStore() {
  const calls: string[] = [];
  const outcomes: RecordOutcome[] = [];
  let card = 0;
  const total = signal(2);
  const store = {
    viewMode: signal<'learn' | 'review' | 'test' | 'edit'>('learn'),
    // Learn
    learnVerses: signal([
      { label: '1:1', text: 'In the beginning was the Word, and the Word was with God.' },
      { label: '1:2', text: 'He was in the beginning with God.' },
    ]),
    learnProgress: signal({ unlocked: 2, learned: 1, done: false }),
    learnChunk: signal({ verseRef: '1:1-2' }),
    // Test
    deck: signal([0, 1]),
    deckComplete: () => card >= total(),
    currentCardIndex: () => card,
    cardRef: () => `Card ${card + 1}`,
    gradeReferenceText: () => `verse text ${card + 1}`,
    againMode: signal<'now' | 'later'>('now'),
    testDriveMode: signal<'desk' | 'drive'>('desk'),
    setTestDriveMode(m: 'desk' | 'drive') {
      calls.push(`drive:${m}`);
      store.testDriveMode.set(m);
    },
  };
  // Recording and grading live on their own service (`MemorizeTest`); the coach calls it directly.
  const test = {
    recordingSupported: () => true,
    recordAndGrade: vi.fn((): Promise<RecordOutcome> => {
      calls.push('record');
      const o = outcomes.shift() ?? graded('good');
      // Like the real store: a good grade commits and advances the deck before the coach hears about it.
      if (o.kind === 'graded' && (o.result.grade !== 'again' || store.againMode() === 'later'))
        card += 1;
      return Promise.resolve(o);
    }),
    cancelCoachedRecording: vi.fn(() => calls.push('cancelRecord')),
    skipCurrentCard: vi.fn(() => {
      calls.push('skipCard');
      card += 1;
    }),
  };
  return {
    store,
    test,
    calls,
    outcomes,
    setCard: (n: number) => (card = n),
    setTotal: (n: number) => total.set(n),
  };
}

function fakePlatform(opts: { supported?: boolean } = {}) {
  const log: string[] = [];
  const platform = {
    supported: opts.supported ?? true,
    speaker: {
      speak: vi.fn((text: string) => {
        log.push(text);
        return Promise.resolve();
      }),
      cancel: vi.fn(),
    },
    tone: vi.fn(() => Promise.resolve()),
    keepalive: { acquire: vi.fn(() => Promise.resolve()), release: vi.fn() },
    loadVoices: vi.fn(() => Promise.resolve([])),
  };
  return { platform, log };
}

describe('MemorizeCoach', () => {
  let fs: ReturnType<typeof fakeStore>;
  let fp: ReturnType<typeof fakePlatform>;
  let coach: MemorizeCoach;

  function setup(platformOpts: { supported?: boolean } = {}): void {
    fs = fakeStore();
    fp = fakePlatform(platformOpts);
    TestBed.configureTestingModule({
      providers: [
        MemorizeCoach,
        { provide: MemorizeStore, useValue: fs.store },
        { provide: MemorizeTest, useValue: fs.test },
        { provide: COACH_PLATFORM, useValue: () => fp.platform },
      ],
    });
    coach = TestBed.inject(MemorizeCoach);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.resetTestingModule();
  });
  afterEach(() => vi.useRealTimers());

  const settle = () => vi.advanceTimersByTimeAsync(60_000);

  describe('Learn coach', () => {
    it('speaks the whole verse first, then teaches it phrase by phrase', async () => {
      setup();
      const started = coach.startLearn();
      await settle();
      await started;
      expect(fp.log[0]).toBe('He was in the beginning with God.');
      expect(fp.log).toContain('Repeat after me.');
      expect(fp.log).toContain('Now verses one through 2, from memory.');
    });

    it('ends by itself, releases the screen, and tells the student the next step', async () => {
      setup();
      const started = coach.startLearn();
      await settle();
      await started;
      expect(coach.mode()).toBe('off');
      expect(fp.platform.keepalive.release).toHaveBeenCalled();
      expect(coach.notice()).toContain('Got it');
    });

    it('takes the wake lock and media keys while it runs', async () => {
      setup();
      void coach.startLearn();
      await vi.advanceTimersByTimeAsync(0);
      expect(fp.platform.keepalive.acquire).toHaveBeenCalledTimes(1);
      expect(coach.mode()).toBe('learn');
      coach.stop();
    });

    it('never records, grades, or changes the drive mode', async () => {
      setup();
      const started = coach.startLearn();
      await settle();
      await started;
      expect(fs.test.recordAndGrade).not.toHaveBeenCalled();
      expect(fs.calls.filter((c) => c !== 'cancelRecord')).toEqual([]);
    });

    it('leaves out the cumulative pass for the first verse', async () => {
      setup();
      fs.store.learnProgress.set({ unlocked: 1, learned: 0, done: false });
      const started = coach.startLearn();
      await settle();
      await started;
      expect(fp.log.join(' ')).not.toContain('through');
      expect(fp.log[0]).toBe('In the beginning was the Word, and the Word was with God.');
    });

    it('stops at once when the mode changes', async () => {
      setup();
      void coach.startLearn();
      await vi.advanceTimersByTimeAsync(0);
      fs.store.viewMode.set('review');
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);
      expect(coach.mode()).toBe('off');
      expect(fp.platform.speaker.cancel).toHaveBeenCalled();
      expect(fp.platform.keepalive.release).toHaveBeenCalled();
    });

    it('can be paused and resumed', async () => {
      setup();
      void coach.startLearn();
      await vi.advanceTimersByTimeAsync(0);
      coach.pause();
      expect(coach.paused()).toBe(true);
      const spoken = fp.log.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fp.log.length).toBe(spoken);
      coach.resume();
      expect(coach.paused()).toBe(false);
      coach.stop();
    });

    it('says so instead of starting when there is no verse', async () => {
      setup();
      fs.store.learnVerses.set([]);
      await coach.startLearn();
      expect(coach.mode()).toBe('off');
      expect(coach.notice()).toContain('Nothing to coach');
    });

    it('does not start in a browser without speech', async () => {
      setup({ supported: false });
      await coach.startLearn();
      expect(coach.mode()).toBe('off');
      expect(coach.notice()).toContain('Speech is not available');
    });

    it('does not start a second session over the first', async () => {
      setup();
      void coach.startLearn();
      await vi.advanceTimersByTimeAsync(0);
      await coach.startLearn();
      expect(fp.platform.keepalive.acquire).toHaveBeenCalledTimes(1);
      coach.stop();
    });
  });

  describe('Test coach', () => {
    beforeEach(() => {
      // jsdom: the real pages stub this; the fake store already answers it
    });

    async function runTest(): Promise<void> {
      fs.store.viewMode.set('test');
      TestBed.tick();
      const started = coach.startTest();
      await settle();
      await started;
    }

    it('asks for each card by reference, listens, then speaks the result', async () => {
      setup();
      fs.outcomes.push(graded('good', ['grace']), graded('easy'));
      await runTest();
      expect(fp.log).toContain('Card 1. Your turn.');
      expect(fp.log).toContain('Good. 90 percent. You missed: grace.');
      expect(fp.log).toContain('Card 2. Your turn.');
      expect(fp.log).toContain('Easy. 90 percent.');
      expect(fp.log[fp.log.length - 1]).toBe("That's the deck. Well done.");
    });

    it('plays the tone before listening, and not when tones are off', async () => {
      setup();
      await runTest();
      expect(fp.platform.tone).toHaveBeenCalled();

      TestBed.resetTestingModule();
      setup();
      coach.setPrefs({ tones: false });
      await runTest();
      expect(fp.platform.tone).not.toHaveBeenCalled();
    });

    it('uses Drive mode for the session and puts the old mode back', async () => {
      setup();
      await runTest();
      expect(fs.calls.filter((c) => c.startsWith('drive:'))).toEqual(['drive:drive', 'drive:desk']);
      expect(fs.store.testDriveMode()).toBe('desk');
    });

    it('repeats a card after "Again" in redo-now mode, then moves on after the attempt limit', async () => {
      setup();
      fs.setTotal(1);
      for (let i = 0; i < MAX_ATTEMPTS_PER_CARD; i += 1) fs.outcomes.push(graded('again', ['x']));
      await runTest();
      expect(fs.test.recordAndGrade).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_CARD);
      expect(fp.log.filter((t) => t.includes('Try again.'))).toHaveLength(
        MAX_ATTEMPTS_PER_CARD - 1,
      );
      expect(fs.test.skipCurrentCard).toHaveBeenCalledTimes(1);
    });

    it('does not repeat an "Again" card when it will be re-queued for later', async () => {
      setup();
      fs.store.againMode.set('later');
      fs.outcomes.push(graded('again'));
      await runTest();
      expect(fp.log.join(' ')).not.toContain('Try again.');
    });

    it('moves on from a card after two silent tries', async () => {
      setup();
      fs.setTotal(1);
      fs.outcomes.push({ kind: 'silent' }, { kind: 'silent' });
      await runTest();
      expect(fs.test.recordAndGrade).toHaveBeenCalledTimes(2);
      expect(fp.log).toContain("I didn't hear anything.");
      expect(fp.log).toContain("I didn't hear anything. Moving on.");
      expect(fs.test.skipCurrentCard).toHaveBeenCalledTimes(1);
    });

    it('skips a card whose grading failed, and says so', async () => {
      setup();
      fs.setTotal(1);
      fs.outcomes.push({ kind: 'failed' });
      await runTest();
      expect(fp.log).toContain("I couldn't check that one. Moving on.");
      expect(fs.test.skipCurrentCard).toHaveBeenCalledTimes(1);
    });

    it('stops with a notice when the microphone is unavailable', async () => {
      setup();
      fs.outcomes.push({ kind: 'unavailable' });
      await runTest();
      expect(coach.mode()).toBe('off');
      expect(coach.notice()).toContain('microphone');
      expect(fs.test.recordAndGrade).toHaveBeenCalledTimes(1);
    });

    it('reads the verse back on "Hear it"', async () => {
      setup();
      fs.store.viewMode.set('test');
      TestBed.tick();
      const started = coach.startTest();
      await vi.advanceTimersByTimeAsync(0);
      // Let it get to the pause after the result, then ask to hear the verse.
      for (let i = 0; i < 20 && !fp.log.includes('Good. 90 percent.'); i += 1) {
        await vi.advanceTimersByTimeAsync(10);
      }
      coach.hearIt();
      await settle();
      await started;
      expect(fp.log).toContain('verse text 1');
    });

    it('does not start when the deck is empty or recording is unsupported', async () => {
      setup();
      fs.setCard(2);
      fs.store.viewMode.set('test');
      await coach.startTest();
      expect(coach.notice()).toContain('nothing to test');

      TestBed.resetTestingModule();
      setup();
      fs.test.recordingSupported = () => false;
      fs.store.viewMode.set('test');
      await coach.startTest();
      expect(coach.notice()).toContain('cannot record');
    });

    it('stop ends the session, cancels listening, and restores Drive mode', async () => {
      setup();
      fs.store.viewMode.set('test');
      TestBed.tick();
      void coach.startTest();
      await vi.advanceTimersByTimeAsync(0);
      coach.stop();
      expect(coach.mode()).toBe('off');
      expect(fs.calls).toContain('drive:desk');
      expect(fp.platform.keepalive.release).toHaveBeenCalled();
    });
  });

  describe('preferences', () => {
    it('start from defaults, clamp what is set, and persist it', () => {
      setup();
      expect(coach.prefs().rate).toBe(1);
      coach.setPrefs({ rate: 5, tones: false });
      expect(coach.prefs().rate).toBe(1.3);
      expect(JSON.parse(localStorage.getItem(COACH_PREFS_KEY) ?? '{}')).toMatchObject({
        rate: 1.3,
        tones: false,
      });
    });

    it('load from storage and reject bad stored values', () => {
      localStorage.setItem(COACH_PREFS_KEY, JSON.stringify({ rate: 0.8, perWordMs: 'slow' }));
      setup();
      expect(coach.prefs().rate).toBe(0.8);
      expect(coach.prefs().perWordMs).toBe(700);
    });

    it('survive unreadable storage', () => {
      localStorage.setItem(COACH_PREFS_KEY, '{not json');
      setup();
      expect(coach.prefs().rate).toBe(1);
    });

    it('fill the voice list on request', async () => {
      setup();
      await coach.ensureVoices();
      expect(fp.platform.loadVoices).toHaveBeenCalledTimes(1);
    });
  });
});
