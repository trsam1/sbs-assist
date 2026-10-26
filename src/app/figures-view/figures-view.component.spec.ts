import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { FiguresViewComponent } from './figures-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { FiguresStudyService } from '../figures-study.service';
import { FiguresAssistService } from '../figures-assist.service';
import { FiguresStudy } from '../models';

function makeStudy(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookStudyId: 'b1',
    bookName: '1 Thessalonians',
    status: 'ready',
    scrollText: 'The day of the Lord comes like a thief in the night.',
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeFiguresStudy(overrides: Partial<FiguresStudy> = {}): FiguresStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    entries: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('FiguresViewComponent', () => {
  let fixture: ComponentFixture<FiguresViewComponent>;
  let component: FiguresViewComponent;
  let getScrollSpy: ReturnType<typeof vi.fn>;
  let getFiguresSpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;
  let suggestSpy: ReturnType<typeof vi.fn>;
  let checkSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    getScrollSpy = vi.fn();
    getFiguresSpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    saveSpy = vi.fn().mockReturnValue(of(makeFiguresStudy()));
    suggestSpy = vi.fn().mockReturnValue(of({ candidates: [] }));
    checkSpy = vi.fn().mockReturnValue(of({ advice: '' }));
    const scrollService: Partial<ScrollStudyService> = {
      getScrollStudy: getScrollSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    const figuresService: Partial<FiguresStudyService> = {
      get: getFiguresSpy as unknown as FiguresStudyService['get'],
      save: saveSpy as unknown as FiguresStudyService['save'],
    };
    const assistService: Partial<FiguresAssistService> = {
      suggest: suggestSpy as unknown as FiguresAssistService['suggest'],
      check: checkSpy as unknown as FiguresAssistService['check'],
    };
    TestBed.configureTestingModule({
      imports: [FiguresViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: FiguresStudyService, useValue: figuresService },
        { provide: FiguresAssistService, useValue: assistService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(FiguresViewComponent);
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

  it('shows an empty editable worksheet for a ready scroll with no saved study', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    expect(component.state()).toBe('ready');
    expect(query('[data-testid="figures-empty"]')).toBeTruthy();
    expect(query('[data-testid="suggest-candidates"]')).toBeTruthy();
    expect(query('[data-testid="figure-entry-add"]')).toBeTruthy();
  });

  it('renders saved entries in order', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getFiguresSpy.mockReturnValue(
      of(
        makeFiguresStudy({
          entries: [
            {
              figureType: 'metaphor',
              otherLabel: '',
              group: 'figure',
              reference: '5:2',
              text: '',
              interpretation: '',
              notes: '',
            },
            {
              figureType: 'antithetic',
              otherLabel: '',
              group: 'parallelism',
              reference: '5:5',
              text: '',
              interpretation: '',
              notes: '',
            },
          ],
        }),
      ),
    );
    fixture.detectChanges();
    expect(queryAll('[data-testid="figure-entry-row"]').length).toBe(2);
  });

  it('shows preparing + back link while the scroll is extracting, and calls no AI', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ status: 'extracting' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
    expect(query('[data-testid="figures-preparing"]')).toBeTruthy();
    expect(suggestSpy).not.toHaveBeenCalled();
  });

  it('shows failed on a 404 and error (with Retry) on a transient failure', () => {
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 404 })));
    fixture.detectChanges();
    expect(component.state()).toBe('failed');

    TestBed.resetTestingModule();
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();
    expect(component.state()).toBe('error');
    expect(query('[data-testid="figures-retry-button"]')).toBeTruthy();
  });

  it('adds, edits and removes a figure entry; "other" reveals the label field', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    component.addEntry();
    fixture.detectChanges();
    expect(queryAll('[data-testid="figure-entry-row"]').length).toBe(1);

    component.setType(0, 'other');
    fixture.detectChanges();
    expect(query('[data-testid="figure-other-label"]')).toBeTruthy();

    component.removeEntry(0);
    fixture.detectChanges();
    expect(queryAll('[data-testid="figure-entry-row"]').length).toBe(0);
  });

  it('recomputes group when the figureType changes', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    component.addEntry();
    component.setType(0, 'antithetic'); // parallelism
    expect(component.entries()[0].group).toBe('parallelism');
    component.setType(0, 'metaphor'); // figure
    expect(component.entries()[0].group).toBe('figure');
  });

  // --- AI boundary (load-bearing) ---

  it('suggest renders advisory candidates but creates NO entries until accept', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    suggestSpy.mockReturnValue(
      of({ candidates: [{ reference: '5:2', suggestedType: 'metaphor', reason: 'theft image' }] }),
    );
    fixture.detectChanges();
    component.suggest();
    fixture.detectChanges();
    expect(suggestSpy).toHaveBeenCalled();
    expect(queryAll('[data-testid="candidate-row"]').length).toBe(1);
    // No entry created by the scan itself.
    expect(component.entries().length).toBe(0);

    // Accept pre-fills an editable entry (reference + suggested type), still student-owned.
    component.acceptCandidate(0);
    fixture.detectChanges();
    expect(component.entries().length).toBe(1);
    expect(component.entries()[0].reference).toBe('5:2');
    expect(component.entries()[0].figureType).toBe('metaphor');
    // The candidate is consumed.
    expect(component.candidates().length).toBe(0);
  });

  it('check shows advice but never changes the entry figureType', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    checkSpy.mockReturnValue(of({ advice: 'Reads more like metonymy. You decide.' }));
    fixture.detectChanges();
    component.addEntry();
    component.setType(0, 'metaphor');
    component.check(0);
    fixture.detectChanges();
    expect(checkSpy).toHaveBeenCalled();
    expect(query('[data-testid="check-result"]')?.textContent).toContain('metonymy');
    // The tag is untouched.
    expect(component.entries()[0].figureType).toBe('metaphor');
  });

  it('a degraded assist response shows a recoverable message and preserves entries', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    suggestSpy.mockReturnValue(of({ candidates: [], degraded: true, message: 'unavailable now' }));
    fixture.detectChanges();
    component.addEntry();
    const before = component.entries().length;
    component.suggest();
    fixture.detectChanges();
    expect(component.suggestError()).toContain('unavailable');
    expect(component.entries().length).toBe(before);
  });

  it('the Explain disclosure shows canned glossary text and makes NO assist call', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    component.addEntry();
    component.setType(0, 'metaphor');
    component.toggleExplain(0);
    fixture.detectChanges();
    const glossary = query('[data-testid="glossary-text"]');
    expect(glossary?.textContent?.toLowerCase()).toContain('comparison');
    expect(suggestSpy).not.toHaveBeenCalled();
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('fires no AI call on load or save', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    component.addEntry();
    component.setField(0, 'reference', '1:1');
    component.save();
    fixture.detectChanges();
    expect(saveSpy).toHaveBeenCalled();
    expect(suggestSpy).not.toHaveBeenCalled();
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('save sends { entries } (dropping empty-reference rows) and reflects returned state', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    component.addEntry();
    component.setField(0, 'reference', '2:6');
    component.addEntry(); // second row, no reference -> dropped
    saveSpy.mockReturnValue(
      of(
        makeFiguresStudy({
          entries: [
            {
              figureType: 'metaphor',
              otherLabel: '',
              group: 'figure',
              reference: '2:6',
              text: '',
              interpretation: '',
              notes: '',
            },
          ],
        }),
      ),
    );
    component.save();
    fixture.detectChanges();
    const sent = saveSpy.mock.calls[0][1] as { entries: unknown[] };
    expect(sent.entries.length).toBe(1);
    expect(query('[data-testid="figures-saved"]')).toBeTruthy();
  });

  it('keeps entered values and shows an inline error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    component.addEntry();
    component.setField(0, 'reference', '2:6');
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    component.save();
    fixture.detectChanges();
    expect(query('[data-testid="figures-save-error"]')).toBeTruthy();
    expect(component.entries()[0].reference).toBe('2:6');
  });
});
