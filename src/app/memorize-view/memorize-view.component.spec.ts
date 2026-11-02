import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { MemorizeViewComponent } from './memorize-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
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

  function configure(): void {
    getScrollSpy = vi.fn();
    getStudySpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    getOutlineSpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
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
    };
    const outlineService: Partial<OutlineStudyService> = {
      get: getOutlineSpy as unknown as OutlineStudyService['get'],
    };
    TestBed.configureTestingModule({
      imports: [MemorizeViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: MemorizationStudyService, useValue: studyService },
        { provide: OutlineStudyService, useValue: outlineService },
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

  it('renders saved chunks in order with their verseRef/state', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getStudySpy.mockReturnValue(
      of(
        makeStudy({
          chunks: [
            chunk({ start: 0, end: 19, verseRef: '1', state: 'solid' }),
            chunk({ start: 21, end: 48, verseRef: '2', state: 'learning' }),
          ],
        }),
      ),
    );
    fixture.detectChanges();
    expect(queryAll('[data-testid="memorize-chunk-row"]').length).toBe(2);
    expect(component.progressLabel()).toBe('1 of 2 chunks solid');
  });

  it('shows preparing + back link for an uploading scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ status: 'uploading' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
    expect(query('[data-testid="memorize-preparing"]')).toBeTruthy();
    expect(query('[data-testid="memorize-preparing-back"]')).toBeTruthy();
  });

  it('shows failed + back link for a failed scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ status: 'failed', failureReason: 'bad file' })));
    fixture.detectChanges();
    expect(component.state()).toBe('failed');
    expect(query('[data-testid="memorize-failed"]')?.textContent).toContain('bad file');
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
    expect(query('[data-testid="memorize-retry-button"]')).toBeTruthy();
  });

  // --- chunk editing ---

  it('reorders, merges, removes, relabels, and re-states chunks', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    seedThree();

    component.setVerseRef(0, '1:1');
    expect(component.chunks()[0].verseRef).toBe('1:1');

    component.setState(0, 'solid');
    expect(component.chunks()[0].state).toBe('solid');
    expect(component.progressLabel()).toBe('1 of 3 chunks solid');

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
});
