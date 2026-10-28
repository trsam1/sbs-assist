import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { InterrogateViewComponent } from './interrogate-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { InterrogationStudyService } from '../interrogation-study.service';
import { InterrogationEntry, InterrogationStudy } from '../models';

function makeScroll(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookStudyId: 'b1',
    bookName: '1 Thessalonians',
    status: 'ready',
    scrollText: 'Some scroll text.',
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function entry(overrides: Partial<InterrogationEntry> = {}): InterrogationEntry {
  return {
    question: 'Why here?',
    category: 'why',
    tags: [],
    passageRef: '',
    answer: '',
    notes: '',
    ...overrides,
  };
}

function makeStudy(overrides: Partial<InterrogationStudy> = {}): InterrogationStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    entries: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('InterrogateViewComponent', () => {
  let fixture: ComponentFixture<InterrogateViewComponent>;
  let component: InterrogateViewComponent;
  let getScrollSpy: ReturnType<typeof vi.fn>;
  let getStudySpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    getScrollSpy = vi.fn();
    getStudySpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    saveSpy = vi.fn().mockReturnValue(of(makeStudy()));
    const scrollService: Partial<ScrollStudyService> = {
      getScrollStudy: getScrollSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    const studyService: Partial<InterrogationStudyService> = {
      get: getStudySpy as unknown as InterrogationStudyService['get'],
      save: saveSpy as unknown as InterrogationStudyService['save'],
    };
    TestBed.configureTestingModule({
      imports: [InterrogateViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: InterrogationStudyService, useValue: studyService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(InterrogateViewComponent);
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

  it('shows an empty editable worksheet for a ready scroll with no saved study', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    expect(component.state()).toBe('ready');
    expect(query('[data-testid="interrogate-empty"]')).toBeTruthy();
    expect(query('[data-testid="interrogation-entry-add"]')).toBeTruthy();
  });

  it('renders saved entries in order with their category', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getStudySpy.mockReturnValue(
      of(
        makeStudy({
          entries: [
            entry({ question: 'A', category: 'who' }),
            entry({ question: 'B', category: 'how' }),
          ],
        }),
      ),
    );
    fixture.detectChanges();
    expect(queryAll('[data-testid="interrogation-entry-row"]').length).toBe(2);
    // The category is bound from the loaded entries (ngModel reflects the signal).
    expect(component.entries().map((e) => e.category)).toEqual(['who', 'how']);
  });

  it('offers the 7 fixed categories from the constant', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getStudySpy.mockReturnValue(of(makeStudy({ entries: [entry()] })));
    fixture.detectChanges();
    const options = queryAll('[data-testid="category-select"] option').map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['who', 'what', 'when', 'where', 'why', 'how', 'other']);
  });

  it('shows preparing + back link while the scroll is extracting', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll({ status: 'extracting' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
    expect(query('[data-testid="interrogate-preparing"]')).toBeTruthy();
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
    expect(query('[data-testid="interrogate-retry-button"]')).toBeTruthy();
  });

  // --- entries ---

  it('adds, edits, reorders and removes an entry', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.addEntry();
    component.addEntry();
    component.setField(0, 'question', 'First');
    component.setField(1, 'question', 'Second');
    fixture.detectChanges();
    expect(queryAll('[data-testid="interrogation-entry-row"]').length).toBe(2);

    component.moveUp(1);
    expect(component.entries().map((e) => e.question)).toEqual(['Second', 'First']);

    component.removeEntry(0);
    expect(component.entries().map((e) => e.question)).toEqual(['First']);
  });

  // --- tags ---

  it('adds a typed tag (normalized), de-dupes, and removes a chip', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.addEntry();
    component.setTagDraft(0, '  About-God ');
    component.addTag(0);
    expect(component.entries()[0].tags).toEqual(['about-god']);
    // duplicate (different casing) is not added
    component.setTagDraft(0, 'ABOUT-GOD');
    component.addTag(0);
    expect(component.entries()[0].tags).toEqual(['about-god']);
    // blank is not added
    component.setTagDraft(0, '   ');
    component.addTag(0);
    expect(component.entries()[0].tags).toEqual(['about-god']);

    component.removeTag(0, 'about-god');
    expect(component.entries()[0].tags).toEqual([]);
  });

  it('keeps the tags editor compact (no chips) when an entry has no tags', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getStudySpy.mockReturnValue(of(makeStudy({ entries: [entry()] })));
    fixture.detectChanges();
    expect(queryAll('[data-testid="tag-chip"]').length).toBe(0);
    // the add-tag input is always present
    expect(query('[data-testid="tag-add-input"]')).toBeTruthy();
  });

  // --- tag filter ---

  it('filters entries by selected tags (AND) and clearing restores all; no mutation', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getStudySpy.mockReturnValue(
      of(
        makeStudy({
          entries: [
            entry({ question: 'God-q', tags: ['about-god'] }),
            entry({ question: 'cmd-q', tags: ['command'] }),
            entry({ question: 'both-q', tags: ['about-god', 'command'] }),
          ],
        }),
      ),
    );
    fixture.detectChanges();
    expect(queryAll('[data-testid="interrogation-entry-row"]').length).toBe(3);

    component.toggleFilter('about-god');
    fixture.detectChanges();
    expect(component.visibleEntries().map((p) => p.entry.question)).toEqual(['God-q', 'both-q']);

    // AND semantics
    component.toggleFilter('command');
    fixture.detectChanges();
    expect(component.visibleEntries().map((p) => p.entry.question)).toEqual(['both-q']);

    component.clearFilter();
    fixture.detectChanges();
    expect(component.visibleEntries().length).toBe(3);
    // the persisted list was never changed by filtering
    expect(component.entries().length).toBe(3);
  });

  it('builds the filter bar from the tags currently in use', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    getStudySpy.mockReturnValue(
      of(makeStudy({ entries: [entry({ tags: ['about-god'] }), entry({ tags: ['context'] })] })),
    );
    fixture.detectChanges();
    const options = queryAll('[data-testid="tag-filter-option"]').map((b) => b.textContent?.trim());
    expect(options).toEqual(['about-god', 'context']);
  });

  // --- blank-question guard + save ---

  it('flags a blank-question row inline on save and drops it from the payload', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.addEntry();
    component.setField(0, 'question', 'Keep me');
    component.addEntry(); // second row left blank -> dropped
    saveSpy.mockReturnValue(of(makeStudy({ entries: [entry({ question: 'Keep me' })] })));
    component.save();
    fixture.detectChanges();
    const sent = saveSpy.mock.calls[0][1] as { entries: InterrogationEntry[] };
    expect(sent.entries.length).toBe(1);
    expect(sent.entries[0].question).toBe('Keep me');
    expect(query('[data-testid="interrogate-saved"]')).toBeTruthy();
  });

  it('normalizes tags in the save payload', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.addEntry();
    component.setField(0, 'question', 'Q');
    // Inject a messy tag list directly to prove the save-time normalization.
    component.entries.update((e) =>
      e.map((entry, i) =>
        i === 0 ? { ...entry, tags: ['About-God', 'about-god', ' Context '] } : entry,
      ),
    );
    component.save();
    const sent = saveSpy.mock.calls[0][1] as { entries: InterrogationEntry[] };
    expect(sent.entries[0].tags).toEqual(['about-god', 'context']);
  });

  it('keeps entered values and shows an inline error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.addEntry();
    component.setField(0, 'question', 'Q');
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    component.save();
    fixture.detectChanges();
    expect(query('[data-testid="interrogate-save-error"]')).toBeTruthy();
    expect(component.entries()[0].question).toBe('Q');
  });

  it('calls only the scroll and interrogation services (no unexpected dependency)', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeScroll()));
    fixture.detectChanges();
    component.addEntry();
    component.setField(0, 'question', 'Q');
    component.save();
    expect(getScrollSpy).toHaveBeenCalled();
    expect(getStudySpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });
});
