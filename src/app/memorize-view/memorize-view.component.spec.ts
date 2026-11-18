import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { MemorizeViewComponent } from './memorize-view.component';
import { MemorizeStore } from './memorize-store';
import { SILENCE_WATCHER } from './coach-ports';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { RecitationGradeService } from '../recitation-grade.service';
import { OutlineStudyService } from '../outline-study.service';
import { MemorizationChunk, MemorizationStudy, OutlineStudy, OutlineParagraph } from '../models';

// Audio coaching listens for silence through the microphone; capture the callback so a test can fire it.
const silenceHandlers: ((why: 'silence' | 'no-speech') => void)[] = [];
const fakeWatchSilence = (
  _stream: unknown,
  _opts: unknown,
  cb: (why: 'silence' | 'no-speech') => void,
): (() => void) => {
  silenceHandlers.push(cb);
  return () => undefined;
};

// A scroll whose text carries verse markers 1,2,3 — the boundaries the by-verses seed walks.
const SCROLL_TEXT = '1 In the beginning. 2 And the earth was formless. 3 Let there be light.';

function makeScroll(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookStudyId: 'b1',
    bookName: 'Genesis',
    status: 'ready',
    scrollText: SCROLL_TEXT,
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function chunk(overrides: Partial<MemorizationChunk> = {}): MemorizationChunk {
  return { start: 0, end: 19, verseRef: '1', state: 'new', ...overrides };
}

function makeStudy(overrides: Partial<MemorizationStudy> = {}): MemorizationStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    chunks: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeOutline(paragraphs: OutlineParagraph[]): OutlineStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    paragraphs,
    groupings: [],
    theme: '',
    purpose: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('MemorizeViewComponent', () => {
  let fixture: ComponentFixture<MemorizeViewComponent>;
  let component: MemorizeViewComponent;
  let store: MemorizeStore;
  let getScrollSpy: ReturnType<typeof vi.fn>;
  let getStudySpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;
  let getOutlineSpy: ReturnType<typeof vi.fn>;
  let getPrefSpy: ReturnType<typeof vi.fn>;
  let putPrefSpy: ReturnType<typeof vi.fn>;
  let gradeRecitationSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    getScrollSpy = vi.fn();
    getStudySpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    getOutlineSpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    getPrefSpy = vi.fn().mockReturnValue(of({ reminderOptIn: false }));
    putPrefSpy = vi
      .fn()
      .mockImplementation((pref: { reminderOptIn: boolean; reminderHour?: number }) => of(pref));
    saveSpy = vi
      .fn()
      .mockImplementation((_id: string, input: { chunks?: MemorizationChunk[] }) =>
        of(makeStudy({ chunks: input.chunks ?? [] })),
      );
    const scrollService: Partial<ScrollStudyService> = {
      getScrollStudy: getScrollSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    const studyService: Partial<MemorizationStudyService> = {
      get: getStudySpy as unknown as MemorizationStudyService['get'],
      save: saveSpy as unknown as MemorizationStudyService['save'],
      getReminderPref: getPrefSpy as unknown as MemorizationStudyService['getReminderPref'],
      putReminderPref: putPrefSpy as unknown as MemorizationStudyService['putReminderPref'],
    };
    const outlineService: Partial<OutlineStudyService> = {
      get: getOutlineSpy as unknown as OutlineStudyService['get'],
    };
    gradeRecitationSpy = vi
      .fn()
      .mockReturnValue(
        of({ grade: 'good', reason: 'ok', accuracyPct: 90, missedWords: [], transcript: 't' }),
      );
    const recitationService: Partial<RecitationGradeService> = {
      gradeRecitation: gradeRecitationSpy as unknown as RecitationGradeService['gradeRecitation'],
    };
    TestBed.configureTestingModule({
      imports: [MemorizeViewComponent],
      providers: [
        provideRouter([]),
        { provide: SILENCE_WATCHER, useValue: fakeWatchSilence },
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: MemorizationStudyService, useValue: studyService },
        { provide: OutlineStudyService, useValue: outlineService },
        { provide: RecitationGradeService, useValue: recitationService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(MemorizeViewComponent);
    component = fixture.componentInstance;
    store = component.store;
  }

  // Seed three chunks (one verse each) for drill/edit tests.
  function seedThree(): void {
    store.setVersesPerChunk(1);
    store.seedByVerseCount();
  }

  function query(sel: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(sel) as HTMLElement | null;
  }
  function queryAll(sel: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(sel)) as HTMLElement[];
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    try {
      localStorage.clear();
    } catch {
      // jsdom always has localStorage; guard for safety.
    }
  });

  // --- state model ---

  it('shows an empty worksheet with seed actions for a ready scroll with no saved study', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    expect(store.state()).toBe('ready');
    expect(query('[data-testid="memorize-empty"]')).toBeTruthy();
    expect(query('[data-testid="seed-by-verses"]')).toBeTruthy();
  });

  it('offers the Step 8 seed only when an outline with paragraphs exists', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    // no outline → button absent
    expect(query('[data-testid="seed-from-step8"]')).toBeFalsy();

    TestBed.resetTestingModule();
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getOutlineSpy.mockReturnValue(
      of(makeOutline([{ startRef: '1', endRef: '2', mainIdea: 'x', notes: '' }])),
    );
    fixture.detectChanges();
    expect(query('[data-testid="seed-from-step8"]')).toBeTruthy();
  });

  it('blocks seeding when the scroll has no markers and no outline', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ scrollText: 'prose with no markers at all' })));
    fixture.detectChanges();
    expect(store.hasVerseMarkers()).toBe(false);
    expect(query('[data-testid="seed-blocked"]')).toBeTruthy();
  });

  it('seeds editable chunks by verse count', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    fixture.detectChanges();
    expect(store.chunks().length).toBe(3);
    expect(store.chunks().map((c) => c.verseRef)).toEqual(['1', '2', '3']);
    expect(queryAll('[data-testid="memorize-chunk-row"]').length).toBe(3);
  });

  it('groups multiple verses per chunk when the count is raised', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    store.setVersesPerChunk(2);
    store.seedByVerseCount();
    expect(store.chunks().map((c) => c.verseRef)).toEqual(['1-2', '3']);
  });

  it('seeds from Step 8 paragraphs, flagging any unmapped paragraph', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getOutlineSpy.mockReturnValue(
      of(
        makeOutline([
          { startRef: '1', endRef: '2', mainIdea: 'a', notes: '' },
          { startRef: '9', endRef: '9', mainIdea: 'b', notes: '' }, // ref not in text
        ]),
      ),
    );
    fixture.detectChanges();
    store.seedFromOutline();
    fixture.detectChanges();
    expect(store.chunks().map((c) => c.verseRef)).toEqual(['1-2']);
    expect(store.seedUnmapped()).toEqual([1]);
    expect(query('[data-testid="seed-unmapped"]')).toBeTruthy();
  });

  it('renders saved chunks in order and derives progress from the schedule', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getStudySpy.mockReturnValue(
      of(
        makeStudy({
          chunks: [
            // "solid" is EARNED: a long interval + a real last-reviewed date derive to solid.
            chunk({
              start: 0,
              end: 19,
              verseRef: '1',
              intervalDays: 30,
              lastReviewed: '2026-10-01',
            }),
            // reviewed once, short interval → learning.
            chunk({
              start: 21,
              end: 48,
              verseRef: '2',
              intervalDays: 1,
              lastReviewed: '2026-10-30',
            }),
          ],
        }),
      ),
    );
    fixture.detectChanges();
    expect(queryAll('[data-testid="memorize-chunk-row"]').length).toBe(2);
    expect(store.chunkStates()).toEqual(['solid', 'learning']);
    expect(store.progressLabel()).toBe('1 of 2 chunks solid');
  });

  it('shows preparing + back link for an uploading scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ status: 'uploading' })));
    fixture.detectChanges();
    expect(store.state()).toBe('preparing');
    expect(query('[data-testid="tool-preparing"]')).toBeTruthy();
    expect(query('[data-testid="tool-preparing-back"]')).toBeTruthy();
  });

  it('shows failed + back link for a failed scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ status: 'failed', failureReason: 'bad file' })));
    fixture.detectChanges();
    expect(store.state()).toBe('failed');
    expect(query('[data-testid="tool-failed"]')?.textContent).toContain('bad file');
  });

  it('treats a 404 scroll as failed and a transient error as recoverable', () => {
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 404 })));
    fixture.detectChanges();
    expect(store.state()).toBe('failed');

    TestBed.resetTestingModule();
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();
    expect(store.state()).toBe('error');
    expect(query('[data-testid="tool-retry"]')).toBeTruthy();
  });

  // --- chunk editing ---

  it('reorders, merges, removes, and relabels chunks', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();

    store.setVerseRef(0, '1:1');
    expect(store.chunks()[0].verseRef).toBe('1:1');

    // Progress is EARNED from the schedule, not set by hand: freshly seeded chunks are all "new".
    expect(store.chunkStates().every((s) => s === 'new')).toBe(true);
    expect(store.progressLabel()).toBe('0 of 3 chunks solid');

    // merge chunk 1 into chunk 0 → union of ranges, count drops
    const before = store.chunks().length;
    const c0start = store.chunks()[0].start;
    const c1end = store.chunks()[1].end;
    store.mergeUp(1);
    expect(store.chunks().length).toBe(before - 1);
    expect(store.chunks()[0].start).toBe(c0start);
    expect(store.chunks()[0].end).toBe(c1end);

    store.removeChunk(0);
    expect(store.chunks().length).toBe(before - 2);
  });

  // --- drill modes ---

  it('chain mode shows the active chunk and the accumulated run', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    store.setMode('chain');
    store.setActive(1);
    fixture.detectChanges();
    // active text is the 2nd verse; chained run includes the 1st too
    expect(store.activeText()).toContain('And the earth');
    expect(store.chainRun()).toContain('In the beginning');
    expect(store.chainRun()).toContain('And the earth');
  });

  it('reveal mode steps full → first-letters → blank', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    store.setMode('reveal');
    store.setActive(0);

    store.setReveal('full');
    expect(store.revealText()).toBe('1 In the beginning.');
    store.setReveal('first');
    expect(store.revealText()).toContain('I_'); // "In" → "I_"
    expect(store.revealText()).not.toContain('beginning');
    store.setReveal('blank');
    expect(store.revealText()).not.toMatch(/[a-zA-Z]/);
  });

  it('cloze mode blanks every Nth word and grades typed answers client-side', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    store.setMode('cloze');
    store.setActive(0);
    store.setClozeN(2);

    const tokens = store.clozeTokens();
    const blankIndices = tokens.map((t, i) => (t.blank ? i : -1)).filter((i) => i >= 0);
    expect(blankIndices.length).toBeGreaterThan(0);

    // Type the correct answer for the first blank, a wrong one for the next.
    const first = blankIndices[0];
    store.setClozeTyped(first, tokens[first].text);
    if (blankIndices[1] !== undefined) {
      store.setClozeTyped(blankIndices[1], 'definitely-wrong');
    }
    store.checkCloze();
    expect(store.clozeResult()[first]).toBe(true);
    if (blankIndices[1] !== undefined) {
      expect(store.clozeResult()[blankIndices[1]]).toBe(false);
    }
    // No service call was made for grading.
    expect(saveSpy).not.toHaveBeenCalled();
  });

  // --- persistence ---

  it('saves offsets/state only (no verse text) and reflects returned state', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    store.setState(0, 'learning');
    store.save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [, input] = saveSpy.mock.calls[0];
    // Each saved chunk carries ONLY offsets + label + state — never text.
    for (const c of input.chunks as MemorizationChunk[]) {
      expect(Object.keys(c).sort()).toEqual(['end', 'start', 'state', 'verseRef']);
    }
    expect(store.saved()).toBe(true);
  });

  it('keeps chunks and shows an inline error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();
    seedThree();
    const count = store.chunks().length;
    store.save();
    fixture.detectChanges();
    expect(store.saveError()).toBe(true);
    expect(store.chunks().length).toBe(count); // values kept
  });

  it('depends only on scroll/memorization/outline services (no AI call)', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    store.save();
    // The only services touched are the scroll loader, outline reader, and the memorization CRUD.
    expect(getScrollSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  // --- v2: spaced-repetition scheduler (SM-2) ---

  describe('review scheduler', () => {
    const TODAY = new Date(2026, 10, 2); // 2026-11-02 local
    const isoDay = (offset: number): string => {
      const d = new Date(2026, 10, 2 + offset);
      const m = `${d.getMonth() + 1}`.padStart(2, '0');
      const day = `${d.getDate()}`.padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    };

    it('renders the due-today queue with the correct count and soonest-first order', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(
          makeStudy({
            chunks: [
              chunk({ verseRef: '1', dueDate: isoDay(5) }), // not due
              chunk({ start: 21, end: 48, verseRef: '2', dueDate: isoDay(-1) }), // overdue
              chunk({ start: 50, end: 70, verseRef: '3', dueDate: isoDay(0) }), // due today
            ],
          }),
        ),
      );
      fixture.detectChanges();
      store.setToday(TODAY);
      fixture.detectChanges();

      expect(store.dueCount()).toBe(2);
      // overdue (dueDate earliest) before due-today
      expect(store.dueQueue().map((r) => r.verseRef)).toEqual(['2', '3']);
      expect(query('[data-testid="memorize-due-count"]')?.textContent).toContain('2');
      expect(queryAll('[data-testid="memorize-due-row"]').length).toBe(2);
    });

    it('shows the nothing-due state when every chunk is scheduled ahead', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk({ dueDate: isoDay(10) })] })));
      fixture.detectChanges();
      store.setToday(TODAY);
      fixture.detectChanges();
      expect(store.dueCount()).toBe(0);
      expect(query('[data-testid="memorize-due-empty"]')).toBeTruthy();
    });

    it('treats a v1 chunk (no schedule fields) as due now', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk(), chunk({ start: 21, end: 48 })] })),
      );
      fixture.detectChanges();
      store.setToday(TODAY);
      fixture.detectChanges();
      expect(store.dueCount()).toBe(2);
    });

    it('grading Good updates the active chunk schedule, persists, and advances the next-due label', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk()] })));
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setActive(0);

      store.grade('good');
      // first successful recall → interval 1, reps 1, dueDate = tomorrow
      const graded = store.chunks()[0];
      expect(graded.repetitions).toBe(1);
      expect(graded.intervalDays).toBe(1);
      expect(graded.dueDate).toBe(isoDay(1));
      expect(graded.lastReviewed).toBe(isoDay(0));
      expect(saveSpy).toHaveBeenCalledTimes(1);
      // the grade's new fields were included in the save payload
      const [, input] = saveSpy.mock.calls[0];
      expect((input.chunks as MemorizationChunk[])[0].intervalDays).toBe(1);

      fixture.detectChanges();
      store.setToday(TODAY);
      expect(store.activeDueLabel()).toBe('due tomorrow');
    });

    it('grading Again resets the chunk to a 1-day interval', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(
          makeStudy({
            chunks: [
              chunk({ easeFactor: 2.6, intervalDays: 40, repetitions: 5, dueDate: isoDay(0) }),
            ],
          }),
        ),
      );
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setActive(0);

      store.grade('again');
      const graded = store.chunks()[0];
      expect(graded.repetitions).toBe(0);
      expect(graded.intervalDays).toBe(1);
      expect(graded.dueDate).toBe(isoDay(1));
    });

    it('grading does NOT change the learned-state ladder (axes stay orthogonal)', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk({ state: 'chained' })] })));
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setActive(0);
      store.grade('easy');
      expect(store.chunks()[0].state).toBe('chained'); // untouched
    });

    it('keeps the optimistic schedule and shows the error when a graded save fails', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk()] })));
      saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setActive(0);
      store.grade('good');
      fixture.detectChanges();
      expect(store.saveError()).toBe(true);
      // schedule was applied optimistically and is kept for the retry
      expect(store.chunks()[0].intervalDays).toBe(1);
    });
  });

  // --- daily reminder preference ---

  describe('reminder preference toggle', () => {
    it('renders the toggle off by default', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      const toggle = query('[data-testid="reminder-optin"]') as HTMLInputElement | null;
      expect(toggle).toBeTruthy();
      expect(store.reminderOptIn()).toBe(false);
      expect(toggle!.checked).toBe(false);
      // hour selector hidden while off
      expect(query('[data-testid="reminder-hour"]')).toBeFalsy();
    });

    it('reads an opted-in preference and renders on, showing the hour', () => {
      configure();
      getPrefSpy.mockReturnValue(of({ reminderOptIn: true, reminderHour: 8 }));
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      expect(store.reminderOptIn()).toBe(true);
      expect(store.reminderHour()).toBe(8);
      expect(query('[data-testid="reminder-hour"]')).toBeTruthy();
    });

    it('persists the preference when toggled on', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      store.setReminderOptIn(true);
      expect(putPrefSpy).toHaveBeenCalledWith({ reminderOptIn: true });
      expect(store.reminderOptIn()).toBe(true);
    });

    it('persists the hour, clamped to 0–23', () => {
      configure();
      getPrefSpy.mockReturnValue(of({ reminderOptIn: true }));
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      store.setReminderHour(99);
      expect(store.reminderHour()).toBe(23);
      expect(putPrefSpy).toHaveBeenCalledWith({ reminderOptIn: true, reminderHour: 23 });
    });

    it('surfaces an inline error on a save failure, keeping the chosen state', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      putPrefSpy.mockReturnValue(throwError(() => ({ status: 500 })));
      fixture.detectChanges();
      store.setReminderOptIn(true);
      fixture.detectChanges();
      expect(store.reminderError()).toMatch(/could not save/i);
      expect(store.reminderOptIn()).toBe(true);
    });
  });

  // --- Review mode: mobile-first flashcard deck ---

  describe('review mode (flashcard deck)', () => {
    const TODAY = new Date(2026, 10, 2); // 2026-11-02 local
    const isoDay = (offset: number): string => {
      const d = new Date(2026, 10, 2 + offset);
      const m = `${d.getMonth() + 1}`.padStart(2, '0');
      const day = `${d.getDate()}`.padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    };

    function loadWithChunks(chunks: MemorizationChunk[]): void {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks })));
      fixture.detectChanges();
      store.setToday(TODAY);
    }

    it('renders the Review/Edit toggle and defaults to Edit', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      expect(query('[data-testid="memorize-mode-toggle"]')).toBeTruthy();
      expect(store.viewMode()).toBe('edit');
      // Edit mode shows the worksheet
      expect(query('[data-testid="seed-controls"]')).toBeTruthy();
      expect(query('[data-testid="memorize-review"]')).toBeFalsy();
    });

    it('switching to Review renders the flashcard and hides the worksheet', () => {
      loadWithChunks([chunk()]);
      store.setViewMode('review');
      fixture.detectChanges();
      expect(store.viewMode()).toBe('review');
      expect(query('[data-testid="memorize-review"]')).toBeTruthy();
      expect(query('[data-testid="review-card"]')).toBeTruthy();
      // worksheet is gone in review mode
      expect(query('[data-testid="seed-controls"]')).toBeFalsy();
    });

    it('builds the deck from the due queue (soonest-first) with progress', () => {
      loadWithChunks([
        chunk({ verseRef: '1', dueDate: isoDay(5), lastReviewed: isoDay(-1) }), // not due
        chunk({
          start: 21,
          end: 48,
          verseRef: '2',
          dueDate: isoDay(-1),
          lastReviewed: isoDay(-3),
        }), // overdue review
        chunk({ start: 50, end: 70, verseRef: '3', dueDate: isoDay(0), lastReviewed: isoDay(-2) }), // due review
      ]);
      store.setViewMode('review');
      fixture.detectChanges();
      // deck holds the two due REVIEW chunks, overdue first (indices 1 then 2)
      expect(store.deck()).toEqual([1, 2]);
      expect(store.deckProgress()).toEqual({ pos: 0, total: 2 });
      expect(query('[data-testid="review-progress"]')?.textContent).toContain('Card 1 of 2');
      expect(store.cardRef()).toBe('2');
    });

    it('meters new chunks per day: review chunks always in, new chunks capped', () => {
      loadWithChunks([
        chunk({ verseRef: '1', dueDate: isoDay(-1), lastReviewed: isoDay(-2) }), // due review
        chunk({ start: 21, end: 48, verseRef: '2' }), // new
        chunk({ start: 50, end: 70, verseRef: '3' }), // new
        chunk({ start: 72, end: 90, verseRef: '4' }), // new
      ]);
      store.setNewPerDay(1);
      store.setViewMode('review');
      fixture.detectChanges();
      // the review chunk (0) plus exactly ONE new chunk (2); chunks 3,4 held back
      expect(store.deck()).toEqual([0, 1]);
      expect(store.newChunkCount()).toBe(3);

      // raising the limit re-introduces the rest immediately
      store.setNewPerDay(5);
      expect(store.deck()).toEqual([0, 1, 2, 3]);
    });

    it('shows the no-chunks empty state pointing at Edit', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      store.setViewMode('review');
      fixture.detectChanges();
      expect(query('[data-testid="review-no-chunks"]')).toBeTruthy();
    });

    it('shows the all-caught-up state when nothing is due', () => {
      loadWithChunks([chunk({ dueDate: isoDay(10) })]);
      store.setViewMode('review');
      fixture.detectChanges();
      expect(store.deck()).toEqual([]);
      expect(store.deckComplete()).toBe(true);
      expect(query('[data-testid="review-complete"]')).toBeTruthy();
    });

    it('flips the card to reveal the chunk text, and the grade row appears only when flipped', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      store.setViewMode('review');
      fixture.detectChanges();
      expect(store.flipped()).toBe(false);
      expect(query('[data-testid="review-grade-row"]')).toBeFalsy();

      store.flip();
      fixture.detectChanges();
      expect(store.flipped()).toBe(true);
      expect(query('[data-testid="review-card-back"]')?.textContent).toContain('In the beginning');
      expect(query('[data-testid="review-grade-row"]')).toBeTruthy();
    });

    it('toggles the first-letters scaffold on the front', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      store.setViewMode('review');
      store.toggleScaffold();
      fixture.detectChanges();
      expect(store.scaffold()).toBe('first');
      expect(query('[data-testid="review-scaffold"]')?.textContent).toContain('I_'); // "In" → "I_"
    });

    it('grading a card runs SM-2, persists, and auto-advances to the next card', () => {
      loadWithChunks([chunk({ verseRef: '1' }), chunk({ start: 21, end: 48, verseRef: '2' })]);
      store.setViewMode('review');
      fixture.detectChanges();
      expect(store.currentCardIndex()).toBe(0);

      store.flip();
      store.gradeCard('good');
      // graded the first chunk via the SM-2 path
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(store.chunks()[0].intervalDays).toBe(1);
      expect(store.chunks()[0].repetitions).toBe(1);
      // advanced to the next card, flipped reset
      expect(store.deckPos()).toBe(1);
      expect(store.currentCardIndex()).toBe(1);
      expect(store.flipped()).toBe(false);
    });

    it('an Again grade in redo-now mode (default) keeps the same card up', () => {
      loadWithChunks([chunk({ verseRef: '1' }), chunk({ start: 21, end: 48, verseRef: '2' })]);
      store.setViewMode('review');
      fixture.detectChanges();
      expect(store.againMode()).toBe('now'); // default
      expect(store.deck()).toEqual([0, 1]);

      store.flip();
      expect(store.flipped()).toBe(true);
      store.gradeCard('again');
      // still on card 0, flipped back to the front to try again — NOT advanced
      expect(store.deckPos()).toBe(0);
      expect(store.currentCardIndex()).toBe(0);
      expect(store.flipped()).toBe(false);
      expect(store.deck()).toEqual([0, 1]); // deck unchanged
      expect(saveSpy).toHaveBeenCalledTimes(1); // the miss was still recorded
    });

    it('an Again grade in later mode requeues the card a few cards on and advances', () => {
      loadWithChunks([
        chunk({ verseRef: '1' }),
        chunk({ start: 21, end: 48, verseRef: '2' }),
        chunk({ start: 50, end: 70, verseRef: '3' }),
      ]);
      store.setNewPerDay(10); // introduce all three new chunks
      store.setViewMode('review');
      store.setAgainMode('later');
      fixture.detectChanges();
      expect(store.deck()).toEqual([0, 1, 2]);

      store.flip();
      store.gradeCard('again');
      // card 0 requeued ~3 cards on (clamped to end here), advanced to position 1
      expect(store.deck()).toEqual([0, 1, 2, 0]);
      expect(store.deckPos()).toBe(1);
      expect(store.currentCardIndex()).toBe(1);
    });

    it('grading does not change the stored learned-state field (axes stay orthogonal)', () => {
      loadWithChunks([chunk({ verseRef: '1', state: 'chained' })]);
      store.setViewMode('review');
      store.flip();
      store.gradeCard('easy');
      expect(store.chunks()[0].state).toBe('chained');
    });

    it('completes the deck after the last card is graded', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      store.setViewMode('review');
      fixture.detectChanges();
      store.flip();
      store.gradeCard('good');
      fixture.detectChanges();
      expect(store.deckComplete()).toBe(true);
      expect(query('[data-testid="review-complete"]')).toBeTruthy();
    });

    it('keyboard: Space flips, then 1-4 grade', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      store.setViewMode('review');
      fixture.detectChanges();

      store.onCardKeydown(new KeyboardEvent('keydown', { key: ' ' }));
      expect(store.flipped()).toBe(true);

      store.onCardKeydown(new KeyboardEvent('keydown', { key: '3' })); // good
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(store.chunks()[0].repetitions).toBe(1);
    });

    it('document keydown is ignored when focus is in a form field', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      store.setViewMode('review');
      fixture.detectChanges();
      const input = document.createElement('input');
      const e = new KeyboardEvent('keydown', { key: ' ' });
      Object.defineProperty(e, 'target', { value: input });
      component.onDocumentKeydown(e);
      expect(store.flipped()).toBe(false); // not flipped — ignored
    });

    it('swipe up no longer flips; swipe left grades Again (redo-now keeps the same card)', () => {
      loadWithChunks([chunk({ verseRef: '1' }), chunk({ start: 21, end: 48, verseRef: '2' })]);
      store.setViewMode('review');
      fixture.detectChanges();

      // swipe up → no flip (tap, Space or Reveal flips)
      store.onCardPointerDown({ clientX: 100, clientY: 300 } as PointerEvent);
      store.onCardPointerUp({ clientX: 100, clientY: 210 } as PointerEvent);
      expect(store.flipped()).toBe(false);

      // reveal, then swipe left → grade again; default redo-now keeps the same card
      store.flip();
      store.onCardPointerDown({ clientX: 200, clientY: 100 } as PointerEvent);
      store.onCardPointerUp({ clientX: 110, clientY: 100 } as PointerEvent);
      expect(saveSpy).toHaveBeenCalled();
      expect(store.deckPos()).toBe(0);
      expect(store.flipped()).toBe(false);
    });

    it('renders the review card as flowing text with no 3-D flip markup', () => {
      loadWithChunks([chunk({ start: 0, end: SCROLL_TEXT.length, verseRef: '1-3' })]);
      store.setViewMode('review');
      fixture.detectChanges();
      expect(query('.flashcard')).toBeFalsy();
      expect(query('[data-testid="review-card-back"]')).toBeFalsy();
      store.flip();
      fixture.detectChanges();
      const back = query('[data-testid="review-card-back"]')?.textContent ?? '';
      expect(back).toContain('In the beginning.');
      expect(back).toContain('Let there be light.');
    });

    it('dismisses the shortcut legend', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      store.setViewMode('review');
      fixture.detectChanges();
      expect(query('[data-testid="review-legend"]')).toBeTruthy();
      store.dismissLegend();
      fixture.detectChanges();
      expect(query('[data-testid="review-legend"]')).toBeFalsy();
    });

    it('Edit mode preserves the existing worksheet surface (non-regression)', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      // default is edit; worksheet pieces all present
      expect(query('[data-testid="seed-controls"]')).toBeTruthy();
      expect(query('[data-testid="memorize-chunk-row"]')).toBeTruthy();
      expect(query('[data-testid="memorize-drill"]')).toBeTruthy();
      expect(query('[data-testid="reminder-pref"]')).toBeTruthy();
      expect(query('[data-testid="memorize-save"]')).toBeTruthy();
    });
  });

  // --- V3: spoken-recitation auto-grade (Test mode) ---

  describe('test mode (auto-grade)', () => {
    const TODAY = new Date(2026, 10, 2);
    /** Load a study with one due chunk and enter Test mode. */
    function enterTestWithDueChunk(): void {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk({ verseRef: '1', dueDate: '' })] })), // never reviewed → due
      );
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setViewMode('test');
      fixture.detectChanges();
    }

    it('renders the Test toggle and enters Test mode with a due card', () => {
      enterTestWithDueChunk();
      expect(query('[data-testid="mode-test"]')).toBeTruthy();
      expect(query('[data-testid="memorize-test"]')).toBeTruthy();
      expect(store.viewMode()).toBe('test');
      expect(store.testPhase()).toBe('idle');
    });

    it('defaults to desk mode (nothing auto-commits)', () => {
      enterTestWithDueChunk();
      expect(store.testDriveMode()).toBe('desk');
    });

    it('desk mode: a graded result proposes a grade; confirming commits via the SM-2 path once', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk({ verseRef: '1', dueDate: '' })] })),
      );
      // Stub recording support BEFORE the first render so the graded branch (not the no-mic
      // fallback) renders; jsdom has no MediaRecorder.
      vi.spyOn(store, 'recordingSupported').mockReturnValue(true);
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setViewMode('test');
      // Simulate a completed grade (bypass the real MediaRecorder, which jsdom lacks).
      store.gradeResult.set({
        grade: 'good',
        reason: 'minor slip',
        accuracyPct: 90,
        missedWords: [],
        transcript: 'said it',
      });
      store.testPhase.set('graded');
      fixture.detectChanges();
      expect(query('[data-testid="test-result"]')).toBeTruthy();
      expect(query('[data-testid="test-grade-row"]')).toBeTruthy();

      store.commitTestGrade('good');
      expect(saveSpy).toHaveBeenCalledTimes(1); // existing SM-2 save path
      expect(store.testPhase()).toBe('idle'); // advanced + reset for the next card
    });

    function enterGradedWith(transcript: string, degraded = false): void {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk({ verseRef: '1', dueDate: '' })] })),
      );
      vi.spyOn(store, 'recordingSupported').mockReturnValue(true);
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setViewMode('test');
      store.gradeResult.set({
        grade: 'hard',
        reason: 'dropped a word',
        accuracyPct: 67,
        missedWords: ['the'],
        transcript,
        ...(degraded ? { degraded: true } : {}),
      });
      store.testPhase.set('graded');
      fixture.detectChanges();
    }

    it('highlights the verse words the student missed and shows what they said', () => {
      enterGradedWith('in beginning');
      const missed = Array.from(
        fixture.nativeElement.querySelectorAll('[data-testid="test-revealed-text"] [data-missed]'),
      ).map((e) => (e as HTMLElement).textContent?.trim());
      expect(missed).toEqual(['the']);
      expect(query('[data-testid="test-missed-summary"]')?.textContent).toContain('Missed 1 word');
      expect(query('[data-testid="test-said"]')?.textContent?.replace(/\s+/g, ' ')).toContain(
        'in beginning',
      );
    });

    it('says every word was there for a perfect recitation', () => {
      enterGradedWith('In the beginning');
      expect(fixture.nativeElement.querySelectorAll('[data-missed]').length).toBe(0);
      expect(query('[data-testid="test-missed-summary"]')?.textContent).toContain(
        'Every word was there',
      );
    });

    it('does not mark every word missed when the grade has no transcript (degraded)', () => {
      enterGradedWith('', true);
      expect(fixture.nativeElement.querySelectorAll('[data-missed]').length).toBe(0);
      expect(query('[data-testid="test-no-transcript"]')).toBeTruthy();
      expect(query('[data-testid="test-revealed-text"]')?.textContent).toContain(
        'In the beginning',
      );
    });

    it('drive mode: a graded result auto-commits without a confirm step', () => {
      enterTestWithDueChunk();
      store.setTestDriveMode('drive');
      // Drive-mode auto-commit happens inside the grade subscription; simulate it directly.
      store.commitTestGrade('good');
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('an Again grade in redo-now mode (default) stays on the same card and resets to record', () => {
      enterTestWithDueChunk();
      const before = store.deck().length;
      const pos = store.deckPos();
      store.commitTestGrade('again');
      expect(store.deck().length).toBe(before); // NOT requeued
      expect(store.deckPos()).toBe(pos); // same card
      expect(store.testPhase()).toBe('idle'); // reset to record again
    });

    it('an Again grade in later mode requeues the card and advances', () => {
      enterTestWithDueChunk();
      store.setAgainMode('later');
      const before = store.deck().length;
      store.commitTestGrade('again');
      expect(store.deck().length).toBe(before + 1); // re-queued
    });

    it('falls back to manual grade buttons when recording is unavailable', () => {
      enterTestWithDueChunk();
      vi.spyOn(store, 'recordingSupported').mockReturnValue(false);
      fixture.detectChanges();
      expect(query('[data-testid="test-no-mic"]')).toBeTruthy();
      expect(query('[data-testid="test-manual-grade-row"]')).toBeTruthy();
    });

    it('shows a no-chunks state in Test mode when nothing is seeded', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges(); // 404 → no study → no chunks
      store.setViewMode('test');
      fixture.detectChanges();
      expect(query('[data-testid="test-no-chunks"]')).toBeTruthy();
    });
  });

  // --- Learn mode: verse by verse, student-paced ---
  describe('learn mode', () => {
    const TODAY = new Date(2026, 10, 2);
    const ALL = { start: 0, end: SCROLL_TEXT.length, verseRef: '1-3' };

    function loadLearn(chunks: MemorizationChunk[]): void {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks })));
      fixture.detectChanges();
      store.setToday(TODAY);
    }

    function lastSavedLearn(): unknown {
      const [, input] = saveSpy.mock.calls[saveSpy.mock.calls.length - 1];
      return (input.chunks as MemorizationChunk[])[0].learn;
    }

    it('adds a Learn toggle and opens the first new chunk with verse 1 current, the rest locked', () => {
      loadLearn([chunk(ALL)]);
      expect(query('[data-testid="mode-learn"]')).toBeTruthy();
      store.setViewMode('learn');
      fixture.detectChanges();
      expect(store.learnIndex()).toBe(0);
      expect(store.learnVerses().map((v) => v.label)).toEqual(['1', '2', '3']);
      expect(query('[data-testid="learn-verse-current"]')).toBeTruthy();
      expect(
        fixture.nativeElement.querySelectorAll('[data-testid="learn-verse-locked"]').length,
      ).toBe(2);
      expect(query('[data-testid="learn-progress"]')?.textContent).toContain(
        '1 of 3 verses unlocked',
      );
    });

    it('lands in Learn when a chunk is mid-way through its Learn run', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 2, learned: 1, done: false } })]);
      expect(store.viewMode()).toBe('learn');
      expect(store.learnProgress().unlocked).toBe(2);
    });

    it('does not land in Learn for a chunk with no Learn progress', () => {
      loadLearn([chunk(ALL)]);
      expect(store.viewMode()).toBe('edit');
    });

    describe('Fill stage with typed answers', () => {
      function enterFill(): void {
        loadLearn([chunk({ ...ALL, learn: { unlocked: 2, learned: 1, done: false } })]);
        store.setClozeN(2); // verse 2: "And [the] earth [was] formless."
        store.setLearnStage('fill');
        fixture.detectChanges();
      }

      const inputs = () =>
        Array.from(
          fixture.nativeElement.querySelectorAll('[data-testid="learn-fill-input"]'),
        ) as HTMLInputElement[];

      function type(i: number, value: string): void {
        const el = inputs()[i];
        el.value = value;
        el.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      }

      it('shows a text box for each blank, labeled by number', () => {
        enterFill();
        expect(inputs().length).toBe(2);
        expect(inputs()[0].getAttribute('aria-label')).toBe('Blank 1 of 2');
        expect(inputs()[1].getAttribute('aria-label')).toBe('Blank 2 of 2');
      });

      it('marks right answers green and wrong ones red when checked, ignoring case and punctuation', () => {
        enterFill();
        type(0, 'The');
        type(1, 'is');
        (query('[data-testid="learn-fill-check"]') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(inputs()[0].classList.contains('is-success')).toBe(true);
        expect(inputs()[1].classList.contains('is-danger')).toBe(true);
        expect(inputs()[1].getAttribute('aria-invalid')).toBe('true');
        expect(query('[data-testid="learn-fill-score"]')?.textContent).toContain('1 of 2 correct');
      });

      it('says all correct without the "fix" hint', () => {
        enterFill();
        type(0, 'the');
        type(1, 'WAS');
        (query('[data-testid="learn-fill-check"]') as HTMLButtonElement).click();
        fixture.detectChanges();
        const text = query('[data-testid="learn-fill-score"]')?.textContent ?? '';
        expect(text).toContain('2 of 2 correct');
        expect(text).not.toContain('fix');
      });

      it('checks when Enter is pressed in a blank', () => {
        enterFill();
        type(0, 'the');
        inputs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        fixture.detectChanges();
        expect(inputs()[0].classList.contains('is-success')).toBe(true);
      });

      it("clears a blank's mark as soon as it is edited", () => {
        enterFill();
        type(0, 'nope');
        store.checkLearnFill();
        fixture.detectChanges();
        expect(inputs()[0].classList.contains('is-danger')).toBe(true);
        type(0, 'th');
        expect(inputs()[0].classList.contains('is-danger')).toBe(false);
        expect(query('[data-testid="learn-fill-score"]')).toBeTruthy(); // the other blank is still checked
      });

      it('keeps what was typed when the student moves to another stage and back', () => {
        enterFill();
        type(0, 'the');
        store.setLearnStage('read');
        store.setLearnStage('fill');
        fixture.detectChanges();
        expect(inputs()[0].value).toBe('the');
      });

      it('starts clean when the blank size changes or a new verse is unlocked', () => {
        enterFill();
        type(0, 'the');
        store.checkLearnFill();
        store.setClozeN(3);
        fixture.detectChanges();
        expect(store.learnFillScore().checked).toBe(false);
        expect(inputs().every((i) => i.value === '')).toBe(true);

        store.setClozeN(2);
        type(0, 'the');
        store.learnUnlockNext();
        fixture.detectChanges();
        expect(store.learnFillTyped()).toEqual({});
      });

      it('Show answers replaces the boxes with the words, and nothing is graded or saved', () => {
        enterFill();
        type(0, 'the');
        (query('[data-testid="learn-fill-reveal"]') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(inputs().length).toBe(0);
        const text = query('[data-testid="learn-fill-text"]')?.textContent ?? '';
        expect(text).toContain('the');
        expect(text).toContain('was');
        expect(saveSpy).not.toHaveBeenCalled();
      });

      it('counts empty blanks as wrong when checked', () => {
        enterFill();
        store.checkLearnFill();
        fixture.detectChanges();
        expect(store.learnFillScore()).toEqual({ total: 2, correct: 0, checked: true });
      });

      it('typing never changes Learn progress', () => {
        enterFill();
        const before = store.learnProgress();
        type(0, 'the');
        store.checkLearnFill();
        expect(store.learnProgress()).toEqual(before);
      });
    });

    it('moves Read to Fill to Recite and hides the cumulative range until revealed', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 2, learned: 1, done: false } })]);
      fixture.detectChanges();
      expect(query('[data-testid="learn-read-text"]')?.textContent).toContain('And the earth');
      store.setLearnStage('fill');
      fixture.detectChanges();
      expect(query('[data-testid="learn-fill-text"]')).toBeTruthy();
      store.setLearnStage('recite');
      fixture.detectChanges();
      expect(query('[data-testid="learn-recite-prompt"]')?.textContent).toContain('verses 1 to 2');
      expect(query('[data-testid="learn-revealed-text"]')).toBeFalsy();
      store.revealLearn();
      fixture.detectChanges();
      expect(query('[data-testid="learn-revealed-text"]')?.textContent).toContain(
        'In the beginning.',
      );
      expect(query('[data-testid="learn-revealed-text"]')?.textContent).toContain('And the earth');
    });

    it('"Got it" marks the verse learned but never unlocks the next one', () => {
      loadLearn([chunk(ALL)]);
      store.setViewMode('learn');
      store.setLearnStage('recite');
      store.revealLearn();
      fixture.detectChanges();
      store.learnGotIt();
      expect(lastSavedLearn()).toEqual({ unlocked: 1, learned: 1, done: false });
      expect(store.learnProgress().unlocked).toBe(1);
    });

    it('unlocks the next verse only on an explicit tap, even if not marked learned', () => {
      loadLearn([chunk(ALL)]);
      store.setViewMode('learn');
      fixture.detectChanges();
      expect(query('[data-testid="learn-unlock-hint"]')).toBeTruthy();
      store.learnUnlockNext();
      expect(lastSavedLearn()).toEqual({ unlocked: 2, learned: 0, done: false });
      expect(store.learnStage()).toBe('read');
    });

    it('"Not yet" sends the student back to Read and keeps the verse unlearned', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 1, learned: 1, done: false } })]);
      store.setLearnStage('recite');
      store.revealLearn();
      store.learnNotYet();
      expect(lastSavedLearn()).toEqual({ unlocked: 1, learned: 0, done: false });
      expect(store.learnStage()).toBe('read');
    });

    it('offers the chunk grade only when every verse is unlocked and learned', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 3, learned: 2, done: false } })]);
      fixture.detectChanges();
      expect(query('[data-testid="learn-grade"]')).toBeFalsy();
      store.learnGrade('good'); // refused: not ready
      expect(saveSpy).not.toHaveBeenCalled();

      store.setLearnStage('recite');
      store.revealLearn();
      store.learnGotIt();
      fixture.detectChanges();
      expect(store.learnReady()).toBe(true);
      expect(query('[data-testid="learn-grade"]')).toBeTruthy();
    });

    it('grading the finished chunk runs SM-2 once, saves the schedule with done, and offers next', () => {
      loadLearn([
        chunk({ ...ALL, learn: { unlocked: 3, learned: 3, done: false } }),
        chunk({ start: 0, end: 5, verseRef: '9' }),
      ]);
      fixture.detectChanges();
      store.learnGrade('good');
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const [, input] = saveSpy.mock.calls[0];
      const saved = (input.chunks as MemorizationChunk[])[0];
      expect(saved.learn).toEqual({ unlocked: 3, learned: 3, done: true });
      expect(saved.repetitions).toBe(1);
      expect(saved.lastReviewed).toBeTruthy();
      fixture.detectChanges();
      expect(query('[data-testid="learn-done"]')).toBeTruthy();
      expect(store.learnNextIndex()).toBe(1);
      store.learnNextChunk();
      expect(store.learnIndex()).toBe(1);
    });

    it('Again on the chunk grade is a miss: not done, last verse back to unlearned, back to Recite', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 3, learned: 3, done: false } })]);
      store.learnGrade('again');
      const saved = saveSpy.mock.calls[0][1].chunks[0] as MemorizationChunk;
      expect(saved.learn).toEqual({ unlocked: 3, learned: 2, done: false });
      expect(saved.repetitions).toBe(0);
      expect(store.learnStage()).toBe('recite');
    });

    it('Relearn resets Learn progress but leaves the SM-2 schedule alone', () => {
      loadLearn([
        chunk({
          ...ALL,
          intervalDays: 6,
          repetitions: 2,
          dueDate: '2026-11-08',
          lastReviewed: '2026-11-02',
          learn: { unlocked: 3, learned: 3, done: true },
        }),
      ]);
      store.setViewMode('learn');
      store.selectLearnChunk(0);
      store.learnRelearn();
      const saved = saveSpy.mock.calls[0][1].chunks[0] as MemorizationChunk;
      expect(saved.learn).toEqual({ unlocked: 1, learned: 0, done: false });
      expect(saved.intervalDays).toBe(6);
      expect(saved.repetitions).toBe(2);
    });

    it('shows the missed-word highlight for a voice result and never touches the schedule', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 1, learned: 0, done: false } })]);
      store.setViewMode('learn');
      store.setLearnStage('recite');
      store.gradeResult.set({
        grade: 'hard',
        reason: 'dropped a word',
        accuracyPct: 67,
        missedWords: ['the'],
        transcript: 'in beginning',
      });
      store.revealLearn();
      fixture.detectChanges();
      const missed = Array.from(
        fixture.nativeElement.querySelectorAll('[data-testid="learn-revealed-text"] [data-missed]'),
      ).map((e) => (e as HTMLElement).textContent?.trim());
      expect(missed).toContain('the');
      expect(query('[data-testid="learn-voice-result"]')?.textContent).toContain('67%');
      expect(saveSpy).not.toHaveBeenCalled();
      expect(store.chunks()[0].repetitions).toBeUndefined();
    });

    it('clamps stale progress when the chunk now has fewer verses', () => {
      loadLearn([
        chunk({ start: 0, end: 19, verseRef: '1', learn: { unlocked: 3, learned: 3, done: true } }),
      ]);
      store.setViewMode('learn');
      store.selectLearnChunk(0);
      expect(store.learnVerses().length).toBe(1);
      expect(store.learnProgress()).toEqual({ unlocked: 1, learned: 1, done: true });
    });

    it('shows the empty state with no chunks', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      store.setViewMode('learn');
      fixture.detectChanges();
      expect(query('[data-testid="learn-no-chunks"]')).toBeTruthy();
    });
  });

  describe('coached recording (audio coaching)', () => {
    class FakeRecorder {
      static last: FakeRecorder | null = null;
      state: 'inactive' | 'recording' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(public stream: unknown) {
        FakeRecorder.last = this;
      }
      start(): void {
        this.state = 'recording';
      }
      stop(): void {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio-bytes']) });
        this.onstop?.();
      }
    }

    let tracksStopped: number;
    let getUserMedia: ReturnType<typeof vi.fn>;
    const realMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    const realDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

    const TODAY = new Date(2026, 10, 2);

    function enterCoachedTest(): void {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk({ verseRef: '1', dueDate: '' })] })),
      );
      fixture.detectChanges();
      store.setToday(TODAY);
      store.setViewMode('test');
      fixture.detectChanges();
    }

    beforeEach(() => {
      silenceHandlers.length = 0;
      tracksStopped = 0;
      FakeRecorder.last = null;
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
      getUserMedia = vi.fn(() =>
        Promise.resolve({
          getTracks: () => [{ stop: () => (tracksStopped += 1) }],
        }),
      );
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
      });
    });

    afterEach(() => {
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = realMediaRecorder;
      if (realDevices) Object.defineProperty(navigator, 'mediaDevices', realDevices);
      else delete (navigator as unknown as Record<string, unknown>)['mediaDevices'];
    });

    const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

    it('listens, grades, and hands the result back before the card commits', async () => {
      enterCoachedTest();
      store.setTestDriveMode('drive');
      const deckBefore = store.deckPos();
      const outcome = store.recordAndGrade({ silenceMs: 2500 });
      await flushPromises();
      expect(store.testPhase()).toBe('recording');
      expect(silenceHandlers.length).toBe(1);

      silenceHandlers[0]('silence'); // the student went quiet: stop and grade
      const result = await outcome;
      expect(result.kind).toBe('graded');
      expect(gradeRecitationSpy).toHaveBeenCalledTimes(1);
      // Drive mode auto-committed the grade and moved on, exactly as it does without the coach.
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(store.deckPos()).toBe(deckBefore + 1);
    });

    it('gives up without grading when the student never starts speaking', async () => {
      enterCoachedTest();
      const outcome = store.recordAndGrade({});
      await flushPromises();
      silenceHandlers[0]('no-speech');
      expect(await outcome).toEqual({ kind: 'silent' });
      expect(gradeRecitationSpy).not.toHaveBeenCalled();
      expect(store.testPhase()).toBe('idle');
      expect(tracksStopped).toBe(1); // the microphone was released
    });

    it('reports an unavailable microphone when permission is denied', async () => {
      enterCoachedTest();
      getUserMedia.mockReturnValueOnce(Promise.reject(new Error('denied')));
      const outcome = store.recordAndGrade({});
      expect(await outcome).toEqual({ kind: 'unavailable' });
      expect(store.testError()).toBe(true);
    });

    it('reports unavailable when the browser cannot record', async () => {
      enterCoachedTest();
      vi.spyOn(store, 'recordingSupported').mockReturnValue(false);
      expect(await store.recordAndGrade({})).toEqual({ kind: 'unavailable' });
    });

    it('reports failed, and leaves the card for manual grading, when the grade service errors', async () => {
      enterCoachedTest();
      gradeRecitationSpy.mockReturnValueOnce(throwError(() => new Error('down')));
      const outcome = store.recordAndGrade({});
      await flushPromises();
      silenceHandlers[0]('silence');
      expect(await outcome).toEqual({ kind: 'failed' });
      expect(store.testError()).toBe(true);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('releases the microphone if the session is cancelled while it is still opening', async () => {
      enterCoachedTest();
      void store.recordAndGrade({});
      store.cancelCoachedRecording(); // before getUserMedia has resolved
      await flushPromises();
      expect(FakeRecorder.last).toBeNull(); // never started a recorder
      expect(tracksStopped).toBe(1);
    });

    it('cancelling a live coached recording throws the clip away without grading', async () => {
      enterCoachedTest();
      void store.recordAndGrade({});
      await flushPromises();
      store.cancelCoachedRecording();
      await flushPromises();
      expect(gradeRecitationSpy).not.toHaveBeenCalled();
      expect(store.testPhase()).toBe('idle');
      expect(tracksStopped).toBe(1);
    });

    it('does nothing when no coached recording is in progress', () => {
      enterCoachedTest();
      store.cancelCoachedRecording();
      expect(store.testPhase()).toBe('idle');
    });

    it('skipCurrentCard moves on without grading', () => {
      enterCoachedTest();
      const pos = store.deckPos();
      store.skipCurrentCard();
      expect(store.deckPos()).toBe(pos + 1);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('leaves the ordinary Record button alone: no waiter, no silence watching', async () => {
      enterCoachedTest();
      await store.startRecording();
      expect(store.testPhase()).toBe('recording');
      expect(silenceHandlers.length).toBe(0);
      store.stopRecording();
      await flushPromises();
      expect(gradeRecitationSpy).toHaveBeenCalledTimes(1);
    });
  });
});
