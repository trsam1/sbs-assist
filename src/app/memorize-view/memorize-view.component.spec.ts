import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { MemorizeViewComponent } from './memorize-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { RecitationGradeService } from '../recitation-grade.service';
import { OutlineStudyService } from '../outline-study.service';
import { MemorizationChunk, MemorizationStudy, OutlineStudy, OutlineParagraph } from '../models';

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
  }

  // Seed three chunks (one verse each) for drill/edit tests.
  function seedThree(): void {
    component.setVersesPerChunk(1);
    component.seedByVerseCount();
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
    expect(component.state()).toBe('ready');
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
    expect(component.hasVerseMarkers()).toBe(false);
    expect(query('[data-testid="seed-blocked"]')).toBeTruthy();
  });

  it('seeds editable chunks by verse count', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    fixture.detectChanges();
    expect(component.chunks().length).toBe(3);
    expect(component.chunks().map((c) => c.verseRef)).toEqual(['1', '2', '3']);
    expect(queryAll('[data-testid="memorize-chunk-row"]').length).toBe(3);
  });

  it('groups multiple verses per chunk when the count is raised', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.setVersesPerChunk(2);
    component.seedByVerseCount();
    expect(component.chunks().map((c) => c.verseRef)).toEqual(['1-2', '3']);
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
    component.seedFromOutline();
    fixture.detectChanges();
    expect(component.chunks().map((c) => c.verseRef)).toEqual(['1-2']);
    expect(component.seedUnmapped()).toEqual([1]);
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
    expect(component.chunkStates()).toEqual(['solid', 'learning']);
    expect(component.progressLabel()).toBe('1 of 2 chunks solid');
  });

  it('shows preparing + back link for an uploading scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ status: 'uploading' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
    expect(query('[data-testid="tool-preparing"]')).toBeTruthy();
    expect(query('[data-testid="tool-preparing-back"]')).toBeTruthy();
  });

  it('shows failed + back link for a failed scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ status: 'failed', failureReason: 'bad file' })));
    fixture.detectChanges();
    expect(component.state()).toBe('failed');
    expect(query('[data-testid="tool-failed"]')?.textContent).toContain('bad file');
  });

  it('treats a 404 scroll as failed and a transient error as recoverable', () => {
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 404 })));
    fixture.detectChanges();
    expect(component.state()).toBe('failed');

    TestBed.resetTestingModule();
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();
    expect(component.state()).toBe('error');
    expect(query('[data-testid="tool-retry"]')).toBeTruthy();
  });

  // --- chunk editing ---

  it('reorders, merges, removes, and relabels chunks', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();

    component.setVerseRef(0, '1:1');
    expect(component.chunks()[0].verseRef).toBe('1:1');

    // Progress is EARNED from the schedule, not set by hand: freshly seeded chunks are all "new".
    expect(component.chunkStates().every((s) => s === 'new')).toBe(true);
    expect(component.progressLabel()).toBe('0 of 3 chunks solid');

    // merge chunk 1 into chunk 0 → union of ranges, count drops
    const before = component.chunks().length;
    const c0start = component.chunks()[0].start;
    const c1end = component.chunks()[1].end;
    component.mergeUp(1);
    expect(component.chunks().length).toBe(before - 1);
    expect(component.chunks()[0].start).toBe(c0start);
    expect(component.chunks()[0].end).toBe(c1end);

    component.removeChunk(0);
    expect(component.chunks().length).toBe(before - 2);
  });

  // --- drill modes ---

  it('chain mode shows the active chunk and the accumulated run', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    component.setMode('chain');
    component.setActive(1);
    fixture.detectChanges();
    // active text is the 2nd verse; chained run includes the 1st too
    expect(component.activeText()).toContain('And the earth');
    expect(component.chainRun()).toContain('In the beginning');
    expect(component.chainRun()).toContain('And the earth');
  });

  it('reveal mode steps full → first-letters → blank', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    component.setMode('reveal');
    component.setActive(0);

    component.setReveal('full');
    expect(component.revealText()).toBe('1 In the beginning.');
    component.setReveal('first');
    expect(component.revealText()).toContain('I_'); // "In" → "I_"
    expect(component.revealText()).not.toContain('beginning');
    component.setReveal('blank');
    expect(component.revealText()).not.toMatch(/[a-zA-Z]/);
  });

  it('cloze mode blanks every Nth word and grades typed answers client-side', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    component.setMode('cloze');
    component.setActive(0);
    component.setClozeN(2);

    const tokens = component.clozeTokens();
    const blankIndices = tokens.map((t, i) => (t.blank ? i : -1)).filter((i) => i >= 0);
    expect(blankIndices.length).toBeGreaterThan(0);

    // Type the correct answer for the first blank, a wrong one for the next.
    const first = blankIndices[0];
    component.setClozeTyped(first, tokens[first].text);
    if (blankIndices[1] !== undefined) {
      component.setClozeTyped(blankIndices[1], 'definitely-wrong');
    }
    component.checkCloze();
    expect(component.clozeResult()[first]).toBe(true);
    if (blankIndices[1] !== undefined) {
      expect(component.clozeResult()[blankIndices[1]]).toBe(false);
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
    component.setState(0, 'learning');
    component.save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [, input] = saveSpy.mock.calls[0];
    // Each saved chunk carries ONLY offsets + label + state — never text.
    for (const c of input.chunks as MemorizationChunk[]) {
      expect(Object.keys(c).sort()).toEqual(['end', 'start', 'state', 'verseRef']);
    }
    expect(component.saved()).toBe(true);
  });

  it('keeps chunks and shows an inline error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();
    seedThree();
    const count = component.chunks().length;
    component.save();
    fixture.detectChanges();
    expect(component.saveError()).toBe(true);
    expect(component.chunks().length).toBe(count); // values kept
  });

  it('depends only on scroll/memorization/outline services (no AI call)', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();
    component.save();
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
      component.setToday(TODAY);
      fixture.detectChanges();

      expect(component.dueCount()).toBe(2);
      // overdue (dueDate earliest) before due-today
      expect(component.dueQueue().map((r) => r.verseRef)).toEqual(['2', '3']);
      expect(query('[data-testid="memorize-due-count"]')?.textContent).toContain('2');
      expect(queryAll('[data-testid="memorize-due-row"]').length).toBe(2);
    });

    it('shows the nothing-due state when every chunk is scheduled ahead', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk({ dueDate: isoDay(10) })] })));
      fixture.detectChanges();
      component.setToday(TODAY);
      fixture.detectChanges();
      expect(component.dueCount()).toBe(0);
      expect(query('[data-testid="memorize-due-empty"]')).toBeTruthy();
    });

    it('treats a v1 chunk (no schedule fields) as due now', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk(), chunk({ start: 21, end: 48 })] })),
      );
      fixture.detectChanges();
      component.setToday(TODAY);
      fixture.detectChanges();
      expect(component.dueCount()).toBe(2);
    });

    it('grading Good updates the active chunk schedule, persists, and advances the next-due label', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk()] })));
      fixture.detectChanges();
      component.setToday(TODAY);
      component.setActive(0);

      component.grade('good');
      // first successful recall → interval 1, reps 1, dueDate = tomorrow
      const graded = component.chunks()[0];
      expect(graded.repetitions).toBe(1);
      expect(graded.intervalDays).toBe(1);
      expect(graded.dueDate).toBe(isoDay(1));
      expect(graded.lastReviewed).toBe(isoDay(0));
      expect(saveSpy).toHaveBeenCalledTimes(1);
      // the grade's new fields were included in the save payload
      const [, input] = saveSpy.mock.calls[0];
      expect((input.chunks as MemorizationChunk[])[0].intervalDays).toBe(1);

      fixture.detectChanges();
      component.setToday(TODAY);
      expect(component.activeDueLabel()).toBe('due tomorrow');
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
      component.setToday(TODAY);
      component.setActive(0);

      component.grade('again');
      const graded = component.chunks()[0];
      expect(graded.repetitions).toBe(0);
      expect(graded.intervalDays).toBe(1);
      expect(graded.dueDate).toBe(isoDay(1));
    });

    it('grading does NOT change the learned-state ladder (axes stay orthogonal)', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk({ state: 'chained' })] })));
      fixture.detectChanges();
      component.setToday(TODAY);
      component.setActive(0);
      component.grade('easy');
      expect(component.chunks()[0].state).toBe('chained'); // untouched
    });

    it('keeps the optimistic schedule and shows the error when a graded save fails', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(of(makeStudy({ chunks: [chunk()] })));
      saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
      fixture.detectChanges();
      component.setToday(TODAY);
      component.setActive(0);
      component.grade('good');
      fixture.detectChanges();
      expect(component.saveError()).toBe(true);
      // schedule was applied optimistically and is kept for the retry
      expect(component.chunks()[0].intervalDays).toBe(1);
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
      expect(component.reminderOptIn()).toBe(false);
      expect(toggle!.checked).toBe(false);
      // hour selector hidden while off
      expect(query('[data-testid="reminder-hour"]')).toBeFalsy();
    });

    it('reads an opted-in preference and renders on, showing the hour', () => {
      configure();
      getPrefSpy.mockReturnValue(of({ reminderOptIn: true, reminderHour: 8 }));
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      expect(component.reminderOptIn()).toBe(true);
      expect(component.reminderHour()).toBe(8);
      expect(query('[data-testid="reminder-hour"]')).toBeTruthy();
    });

    it('persists the preference when toggled on', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      component.setReminderOptIn(true);
      expect(putPrefSpy).toHaveBeenCalledWith({ reminderOptIn: true });
      expect(component.reminderOptIn()).toBe(true);
    });

    it('persists the hour, clamped to 0–23', () => {
      configure();
      getPrefSpy.mockReturnValue(of({ reminderOptIn: true }));
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      component.setReminderHour(99);
      expect(component.reminderHour()).toBe(23);
      expect(putPrefSpy).toHaveBeenCalledWith({ reminderOptIn: true, reminderHour: 23 });
    });

    it('surfaces an inline error on a save failure, keeping the chosen state', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      putPrefSpy.mockReturnValue(throwError(() => ({ status: 500 })));
      fixture.detectChanges();
      component.setReminderOptIn(true);
      fixture.detectChanges();
      expect(component.reminderError()).toMatch(/could not save/i);
      expect(component.reminderOptIn()).toBe(true);
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
      component.setToday(TODAY);
    }

    it('renders the Review/Edit toggle and defaults to Edit', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      expect(query('[data-testid="memorize-mode-toggle"]')).toBeTruthy();
      expect(component.viewMode()).toBe('edit');
      // Edit mode shows the worksheet
      expect(query('[data-testid="seed-controls"]')).toBeTruthy();
      expect(query('[data-testid="memorize-review"]')).toBeFalsy();
    });

    it('switching to Review renders the flashcard and hides the worksheet', () => {
      loadWithChunks([chunk()]);
      component.setViewMode('review');
      fixture.detectChanges();
      expect(component.viewMode()).toBe('review');
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
      component.setViewMode('review');
      fixture.detectChanges();
      // deck holds the two due REVIEW chunks, overdue first (indices 1 then 2)
      expect(component.deck()).toEqual([1, 2]);
      expect(component.deckProgress()).toEqual({ pos: 0, total: 2 });
      expect(query('[data-testid="review-progress"]')?.textContent).toContain('Card 1 of 2');
      expect(component.cardRef()).toBe('2');
    });

    it('meters new chunks per day: review chunks always in, new chunks capped', () => {
      loadWithChunks([
        chunk({ verseRef: '1', dueDate: isoDay(-1), lastReviewed: isoDay(-2) }), // due review
        chunk({ start: 21, end: 48, verseRef: '2' }), // new
        chunk({ start: 50, end: 70, verseRef: '3' }), // new
        chunk({ start: 72, end: 90, verseRef: '4' }), // new
      ]);
      component.setNewPerDay(1);
      component.setViewMode('review');
      fixture.detectChanges();
      // the review chunk (0) plus exactly ONE new chunk (2); chunks 3,4 held back
      expect(component.deck()).toEqual([0, 1]);
      expect(component.newChunkCount()).toBe(3);

      // raising the limit re-introduces the rest immediately
      component.setNewPerDay(5);
      expect(component.deck()).toEqual([0, 1, 2, 3]);
    });

    it('shows the no-chunks empty state pointing at Edit', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      component.setViewMode('review');
      fixture.detectChanges();
      expect(query('[data-testid="review-no-chunks"]')).toBeTruthy();
    });

    it('shows the all-caught-up state when nothing is due', () => {
      loadWithChunks([chunk({ dueDate: isoDay(10) })]);
      component.setViewMode('review');
      fixture.detectChanges();
      expect(component.deck()).toEqual([]);
      expect(component.deckComplete()).toBe(true);
      expect(query('[data-testid="review-complete"]')).toBeTruthy();
    });

    it('flips the card to reveal the chunk text, and the grade row appears only when flipped', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      component.setViewMode('review');
      fixture.detectChanges();
      expect(component.flipped()).toBe(false);
      expect(query('[data-testid="review-grade-row"]')).toBeFalsy();

      component.flip();
      fixture.detectChanges();
      expect(component.flipped()).toBe(true);
      expect(query('[data-testid="review-card-back"]')?.textContent).toContain('In the beginning');
      expect(query('[data-testid="review-grade-row"]')).toBeTruthy();
    });

    it('toggles the first-letters scaffold on the front', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      component.setViewMode('review');
      component.toggleScaffold();
      fixture.detectChanges();
      expect(component.scaffold()).toBe('first');
      expect(query('[data-testid="review-scaffold"]')?.textContent).toContain('I_'); // "In" → "I_"
    });

    it('grading a card runs SM-2, persists, and auto-advances to the next card', () => {
      loadWithChunks([chunk({ verseRef: '1' }), chunk({ start: 21, end: 48, verseRef: '2' })]);
      component.setViewMode('review');
      fixture.detectChanges();
      expect(component.currentCardIndex()).toBe(0);

      component.flip();
      component.gradeCard('good');
      // graded the first chunk via the SM-2 path
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(component.chunks()[0].intervalDays).toBe(1);
      expect(component.chunks()[0].repetitions).toBe(1);
      // advanced to the next card, flipped reset
      expect(component.deckPos()).toBe(1);
      expect(component.currentCardIndex()).toBe(1);
      expect(component.flipped()).toBe(false);
    });

    it('an Again grade in redo-now mode (default) keeps the same card up', () => {
      loadWithChunks([chunk({ verseRef: '1' }), chunk({ start: 21, end: 48, verseRef: '2' })]);
      component.setViewMode('review');
      fixture.detectChanges();
      expect(component.againMode()).toBe('now'); // default
      expect(component.deck()).toEqual([0, 1]);

      component.flip();
      expect(component.flipped()).toBe(true);
      component.gradeCard('again');
      // still on card 0, flipped back to the front to try again — NOT advanced
      expect(component.deckPos()).toBe(0);
      expect(component.currentCardIndex()).toBe(0);
      expect(component.flipped()).toBe(false);
      expect(component.deck()).toEqual([0, 1]); // deck unchanged
      expect(saveSpy).toHaveBeenCalledTimes(1); // the miss was still recorded
    });

    it('an Again grade in later mode requeues the card a few cards on and advances', () => {
      loadWithChunks([
        chunk({ verseRef: '1' }),
        chunk({ start: 21, end: 48, verseRef: '2' }),
        chunk({ start: 50, end: 70, verseRef: '3' }),
      ]);
      component.setNewPerDay(10); // introduce all three new chunks
      component.setViewMode('review');
      component.setAgainMode('later');
      fixture.detectChanges();
      expect(component.deck()).toEqual([0, 1, 2]);

      component.flip();
      component.gradeCard('again');
      // card 0 requeued ~3 cards on (clamped to end here), advanced to position 1
      expect(component.deck()).toEqual([0, 1, 2, 0]);
      expect(component.deckPos()).toBe(1);
      expect(component.currentCardIndex()).toBe(1);
    });

    it('grading does not change the stored learned-state field (axes stay orthogonal)', () => {
      loadWithChunks([chunk({ verseRef: '1', state: 'chained' })]);
      component.setViewMode('review');
      component.flip();
      component.gradeCard('easy');
      expect(component.chunks()[0].state).toBe('chained');
    });

    it('completes the deck after the last card is graded', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      component.setViewMode('review');
      fixture.detectChanges();
      component.flip();
      component.gradeCard('good');
      fixture.detectChanges();
      expect(component.deckComplete()).toBe(true);
      expect(query('[data-testid="review-complete"]')).toBeTruthy();
    });

    it('keyboard: Space flips, then 1-4 grade', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      component.setViewMode('review');
      fixture.detectChanges();

      component.onCardKeydown(new KeyboardEvent('keydown', { key: ' ' }));
      expect(component.flipped()).toBe(true);

      component.onCardKeydown(new KeyboardEvent('keydown', { key: '3' })); // good
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(component.chunks()[0].repetitions).toBe(1);
    });

    it('document keydown is ignored when focus is in a form field', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      component.setViewMode('review');
      fixture.detectChanges();
      const input = document.createElement('input');
      const e = new KeyboardEvent('keydown', { key: ' ' });
      Object.defineProperty(e, 'target', { value: input });
      component.onDocumentKeydown(e);
      expect(component.flipped()).toBe(false); // not flipped — ignored
    });

    it('swipe up no longer flips; swipe left grades Again (redo-now keeps the same card)', () => {
      loadWithChunks([chunk({ verseRef: '1' }), chunk({ start: 21, end: 48, verseRef: '2' })]);
      component.setViewMode('review');
      fixture.detectChanges();

      // swipe up → no flip (tap, Space or Reveal flips)
      component.onCardPointerDown({ clientX: 100, clientY: 300 } as PointerEvent);
      component.onCardPointerUp({ clientX: 100, clientY: 210 } as PointerEvent);
      expect(component.flipped()).toBe(false);

      // reveal, then swipe left → grade again; default redo-now keeps the same card
      component.flip();
      component.onCardPointerDown({ clientX: 200, clientY: 100 } as PointerEvent);
      component.onCardPointerUp({ clientX: 110, clientY: 100 } as PointerEvent);
      expect(saveSpy).toHaveBeenCalled();
      expect(component.deckPos()).toBe(0);
      expect(component.flipped()).toBe(false);
    });

    it('renders the review card as flowing text with no 3-D flip markup', () => {
      loadWithChunks([chunk({ start: 0, end: SCROLL_TEXT.length, verseRef: '1-3' })]);
      component.setViewMode('review');
      fixture.detectChanges();
      expect(query('.flashcard')).toBeFalsy();
      expect(query('[data-testid="review-card-back"]')).toBeFalsy();
      component.flip();
      fixture.detectChanges();
      const back = query('[data-testid="review-card-back"]')?.textContent ?? '';
      expect(back).toContain('In the beginning.');
      expect(back).toContain('Let there be light.');
    });

    it('dismisses the shortcut legend', () => {
      loadWithChunks([chunk({ verseRef: '1' })]);
      component.setViewMode('review');
      fixture.detectChanges();
      expect(query('[data-testid="review-legend"]')).toBeTruthy();
      component.dismissLegend();
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
      component.setToday(TODAY);
      component.setViewMode('test');
      fixture.detectChanges();
    }

    it('renders the Test toggle and enters Test mode with a due card', () => {
      enterTestWithDueChunk();
      expect(query('[data-testid="mode-test"]')).toBeTruthy();
      expect(query('[data-testid="memorize-test"]')).toBeTruthy();
      expect(component.viewMode()).toBe('test');
      expect(component.testPhase()).toBe('idle');
    });

    it('defaults to desk mode (nothing auto-commits)', () => {
      enterTestWithDueChunk();
      expect(component.testDriveMode()).toBe('desk');
    });

    it('desk mode: a graded result proposes a grade; confirming commits via the SM-2 path once', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk({ verseRef: '1', dueDate: '' })] })),
      );
      // Stub recording support BEFORE the first render so the graded branch (not the no-mic
      // fallback) renders; jsdom has no MediaRecorder.
      vi.spyOn(component, 'recordingSupported').mockReturnValue(true);
      fixture.detectChanges();
      component.setToday(TODAY);
      component.setViewMode('test');
      // Simulate a completed grade (bypass the real MediaRecorder, which jsdom lacks).
      component.gradeResult.set({
        grade: 'good',
        reason: 'minor slip',
        accuracyPct: 90,
        missedWords: [],
        transcript: 'said it',
      });
      component.testPhase.set('graded');
      fixture.detectChanges();
      expect(query('[data-testid="test-result"]')).toBeTruthy();
      expect(query('[data-testid="test-grade-row"]')).toBeTruthy();

      component.commitTestGrade('good');
      expect(saveSpy).toHaveBeenCalledTimes(1); // existing SM-2 save path
      expect(component.testPhase()).toBe('idle'); // advanced + reset for the next card
    });

    function enterGradedWith(transcript: string, degraded = false): void {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      getStudySpy.mockReturnValue(
        of(makeStudy({ chunks: [chunk({ verseRef: '1', dueDate: '' })] })),
      );
      vi.spyOn(component, 'recordingSupported').mockReturnValue(true);
      fixture.detectChanges();
      component.setToday(TODAY);
      component.setViewMode('test');
      component.gradeResult.set({
        grade: 'hard',
        reason: 'dropped a word',
        accuracyPct: 67,
        missedWords: ['the'],
        transcript,
        ...(degraded ? { degraded: true } : {}),
      });
      component.testPhase.set('graded');
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
      component.setTestDriveMode('drive');
      // Drive-mode auto-commit happens inside the grade subscription; simulate it directly.
      component.commitTestGrade('good');
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('an Again grade in redo-now mode (default) stays on the same card and resets to record', () => {
      enterTestWithDueChunk();
      const before = component.deck().length;
      const pos = component.deckPos();
      component.commitTestGrade('again');
      expect(component.deck().length).toBe(before); // NOT requeued
      expect(component.deckPos()).toBe(pos); // same card
      expect(component.testPhase()).toBe('idle'); // reset to record again
    });

    it('an Again grade in later mode requeues the card and advances', () => {
      enterTestWithDueChunk();
      component.setAgainMode('later');
      const before = component.deck().length;
      component.commitTestGrade('again');
      expect(component.deck().length).toBe(before + 1); // re-queued
    });

    it('falls back to manual grade buttons when recording is unavailable', () => {
      enterTestWithDueChunk();
      vi.spyOn(component, 'recordingSupported').mockReturnValue(false);
      fixture.detectChanges();
      expect(query('[data-testid="test-no-mic"]')).toBeTruthy();
      expect(query('[data-testid="test-manual-grade-row"]')).toBeTruthy();
    });

    it('shows a no-chunks state in Test mode when nothing is seeded', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges(); // 404 → no study → no chunks
      component.setViewMode('test');
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
      component.setToday(TODAY);
    }

    function lastSavedLearn(): unknown {
      const [, input] = saveSpy.mock.calls[saveSpy.mock.calls.length - 1];
      return (input.chunks as MemorizationChunk[])[0].learn;
    }

    it('adds a Learn toggle and opens the first new chunk with verse 1 current, the rest locked', () => {
      loadLearn([chunk(ALL)]);
      expect(query('[data-testid="mode-learn"]')).toBeTruthy();
      component.setViewMode('learn');
      fixture.detectChanges();
      expect(component.learnIndex()).toBe(0);
      expect(component.learnVerses().map((v) => v.label)).toEqual(['1', '2', '3']);
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
      expect(component.viewMode()).toBe('learn');
      expect(component.learnProgress().unlocked).toBe(2);
    });

    it('does not land in Learn for a chunk with no Learn progress', () => {
      loadLearn([chunk(ALL)]);
      expect(component.viewMode()).toBe('edit');
    });

    it('moves Read to Fill to Recite and hides the cumulative range until revealed', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 2, learned: 1, done: false } })]);
      fixture.detectChanges();
      expect(query('[data-testid="learn-read-text"]')?.textContent).toContain('And the earth');
      component.setLearnStage('fill');
      fixture.detectChanges();
      expect(query('[data-testid="learn-fill-text"]')).toBeTruthy();
      component.setLearnStage('recite');
      fixture.detectChanges();
      expect(query('[data-testid="learn-recite-prompt"]')?.textContent).toContain('verses 1 to 2');
      expect(query('[data-testid="learn-revealed-text"]')).toBeFalsy();
      component.revealLearn();
      fixture.detectChanges();
      expect(query('[data-testid="learn-revealed-text"]')?.textContent).toContain(
        'In the beginning.',
      );
      expect(query('[data-testid="learn-revealed-text"]')?.textContent).toContain('And the earth');
    });

    it('"Got it" marks the verse learned but never unlocks the next one', () => {
      loadLearn([chunk(ALL)]);
      component.setViewMode('learn');
      component.setLearnStage('recite');
      component.revealLearn();
      fixture.detectChanges();
      component.learnGotIt();
      expect(lastSavedLearn()).toEqual({ unlocked: 1, learned: 1, done: false });
      expect(component.learnProgress().unlocked).toBe(1);
    });

    it('unlocks the next verse only on an explicit tap, even if not marked learned', () => {
      loadLearn([chunk(ALL)]);
      component.setViewMode('learn');
      fixture.detectChanges();
      expect(query('[data-testid="learn-unlock-hint"]')).toBeTruthy();
      component.learnUnlockNext();
      expect(lastSavedLearn()).toEqual({ unlocked: 2, learned: 0, done: false });
      expect(component.learnStage()).toBe('read');
    });

    it('"Not yet" sends the student back to Read and keeps the verse unlearned', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 1, learned: 1, done: false } })]);
      component.setLearnStage('recite');
      component.revealLearn();
      component.learnNotYet();
      expect(lastSavedLearn()).toEqual({ unlocked: 1, learned: 0, done: false });
      expect(component.learnStage()).toBe('read');
    });

    it('offers the chunk grade only when every verse is unlocked and learned', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 3, learned: 2, done: false } })]);
      fixture.detectChanges();
      expect(query('[data-testid="learn-grade"]')).toBeFalsy();
      component.learnGrade('good'); // refused: not ready
      expect(saveSpy).not.toHaveBeenCalled();

      component.setLearnStage('recite');
      component.revealLearn();
      component.learnGotIt();
      fixture.detectChanges();
      expect(component.learnReady()).toBe(true);
      expect(query('[data-testid="learn-grade"]')).toBeTruthy();
    });

    it('grading the finished chunk runs SM-2 once, saves the schedule with done, and offers next', () => {
      loadLearn([
        chunk({ ...ALL, learn: { unlocked: 3, learned: 3, done: false } }),
        chunk({ start: 0, end: 5, verseRef: '9' }),
      ]);
      fixture.detectChanges();
      component.learnGrade('good');
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const [, input] = saveSpy.mock.calls[0];
      const saved = (input.chunks as MemorizationChunk[])[0];
      expect(saved.learn).toEqual({ unlocked: 3, learned: 3, done: true });
      expect(saved.repetitions).toBe(1);
      expect(saved.lastReviewed).toBeTruthy();
      fixture.detectChanges();
      expect(query('[data-testid="learn-done"]')).toBeTruthy();
      expect(component.learnNextIndex()).toBe(1);
      component.learnNextChunk();
      expect(component.learnIndex()).toBe(1);
    });

    it('Again on the chunk grade is a miss: not done, last verse back to unlearned, back to Recite', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 3, learned: 3, done: false } })]);
      component.learnGrade('again');
      const saved = saveSpy.mock.calls[0][1].chunks[0] as MemorizationChunk;
      expect(saved.learn).toEqual({ unlocked: 3, learned: 2, done: false });
      expect(saved.repetitions).toBe(0);
      expect(component.learnStage()).toBe('recite');
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
      component.setViewMode('learn');
      component.selectLearnChunk(0);
      component.learnRelearn();
      const saved = saveSpy.mock.calls[0][1].chunks[0] as MemorizationChunk;
      expect(saved.learn).toEqual({ unlocked: 1, learned: 0, done: false });
      expect(saved.intervalDays).toBe(6);
      expect(saved.repetitions).toBe(2);
    });

    it('shows the missed-word highlight for a voice result and never touches the schedule', () => {
      loadLearn([chunk({ ...ALL, learn: { unlocked: 1, learned: 0, done: false } })]);
      component.setViewMode('learn');
      component.setLearnStage('recite');
      component.gradeResult.set({
        grade: 'hard',
        reason: 'dropped a word',
        accuracyPct: 67,
        missedWords: ['the'],
        transcript: 'in beginning',
      });
      component.revealLearn();
      fixture.detectChanges();
      const missed = Array.from(
        fixture.nativeElement.querySelectorAll('[data-testid="learn-revealed-text"] [data-missed]'),
      ).map((e) => (e as HTMLElement).textContent?.trim());
      expect(missed).toContain('the');
      expect(query('[data-testid="learn-voice-result"]')?.textContent).toContain('67%');
      expect(saveSpy).not.toHaveBeenCalled();
      expect(component.chunks()[0].repetitions).toBeUndefined();
    });

    it('clamps stale progress when the chunk now has fewer verses', () => {
      loadLearn([
        chunk({ start: 0, end: 19, verseRef: '1', learn: { unlocked: 3, learned: 3, done: true } }),
      ]);
      component.setViewMode('learn');
      component.selectLearnChunk(0);
      expect(component.learnVerses().length).toBe(1);
      expect(component.learnProgress()).toEqual({ unlocked: 1, learned: 1, done: true });
    });

    it('shows the empty state with no chunks', () => {
      configure();
      getScrollSpy.mockReturnValue(of(makeScroll()));
      fixture.detectChanges();
      component.setViewMode('learn');
      fixture.detectChanges();
      expect(query('[data-testid="learn-no-chunks"]')).toBeTruthy();
    });
  });
});
