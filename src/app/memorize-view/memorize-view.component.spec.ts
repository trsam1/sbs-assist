import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { MemorizeViewComponent } from './memorize-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { MemorizationChunk, MemorizationStudy } from '../models';

const SCROLL_TEXT = '1 In the beginning.\n\n2 And the earth was formless.\n\n3 Let there be light.';

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

describe('MemorizeViewComponent', () => {
  let fixture: ComponentFixture<MemorizeViewComponent>;
  let component: MemorizeViewComponent;
  let getScrollSpy: ReturnType<typeof vi.fn>;
  let getStudySpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    getScrollSpy = vi.fn();
    getStudySpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
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
    TestBed.configureTestingModule({
      imports: [MemorizeViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: MemorizationStudyService, useValue: studyService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(MemorizeViewComponent);
    component = fixture.componentInstance;
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

  it('shows an empty worksheet with a seed action for a ready scroll with no saved study', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    expect(component.state()).toBe('ready');
    expect(query('[data-testid="memorize-empty"]')).toBeTruthy();
    expect(query('[data-testid="memorize-seed"]')).toBeTruthy();
  });

  it('seeds editable chunks from the scroll text', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.seed();
    fixture.detectChanges();
    expect(component.chunks().length).toBe(3);
    // lifted verse markers as labels
    expect(component.chunks().map((c) => c.verseRef)).toEqual(['1', '2', '3']);
    expect(queryAll('[data-testid="memorize-chunk-row"]').length).toBe(3);
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
    component.seed();

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
    component.seed();
    component.setMode('chain');
    component.setActive(1);
    fixture.detectChanges();
    // active text is the 2nd paragraph; chained run includes the 1st too
    expect(component.activeText()).toContain('And the earth');
    expect(component.chainRun()).toContain('In the beginning');
    expect(component.chainRun()).toContain('And the earth');
  });

  it('reveal mode steps full → first-letters → blank', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.seed();
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
    component.seed();
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
    component.seed();
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
    component.seed();
    const count = component.chunks().length;
    component.save();
    fixture.detectChanges();
    expect(component.saveError()).toBe(true);
    expect(component.chunks().length).toBe(count); // values kept
  });

  it('depends only on ScrollStudyService and MemorizationStudyService (no AI call)', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.seed();
    component.save();
    // The only services touched are the scroll loader and the memorization CRUD.
    expect(getScrollSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });
});
