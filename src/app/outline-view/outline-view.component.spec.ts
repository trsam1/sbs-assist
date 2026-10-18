import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { OutlineViewComponent } from './outline-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { OutlineStudyService } from '../outline-study.service';
import { StructureStudyService } from '../structure-study.service';
import { OutlineStudy, StructureStudy } from '../models';

function makeStudy(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookName: 'Philippians',
    status: 'ready',
    scrollText: 'Finally brethren rejoice. Rejoice always.',
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeOutlineStudy(overrides: Partial<OutlineStudy> = {}): OutlineStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    paragraphs: [],
    groupings: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeStructureStudy(overrides: Partial<StructureStudy> = {}): StructureStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    genre: '',
    tone: '',
    markers: [],
    sections: [],
    elements: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('OutlineViewComponent', () => {
  let fixture: ComponentFixture<OutlineViewComponent>;
  let component: OutlineViewComponent;
  let getScrollSpy: ReturnType<typeof vi.fn>;
  let getOutlineSpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;
  let getStructSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    getScrollSpy = vi.fn();
    getOutlineSpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    saveSpy = vi.fn().mockReturnValue(of(makeOutlineStudy()));
    getStructSpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    const scrollService: Partial<ScrollStudyService> = {
      getScrollStudy: getScrollSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    const outlineService: Partial<OutlineStudyService> = {
      get: getOutlineSpy as unknown as OutlineStudyService['get'],
      save: saveSpy as unknown as OutlineStudyService['save'],
    };
    const structService: Partial<StructureStudyService> = {
      get: getStructSpy as unknown as StructureStudyService['get'],
    };
    TestBed.configureTestingModule({
      imports: [OutlineViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: OutlineStudyService, useValue: outlineService },
        { provide: StructureStudyService, useValue: structService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(OutlineViewComponent);
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

  it('shows an empty editable worksheet for a ready scroll with no saved outline', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    expect(component.state()).toBe('ready');
    expect(query('[data-testid="outline-flow"]')).not.toBeNull();
    expect(query('[data-testid="outline-empty"]')).not.toBeNull();
    expect(queryAll('[data-testid="paragraph-row"]').length).toBe(0);
    expect(query('[data-testid="outline-import"]')).toBeNull();
    expect(query('[data-testid="outline-standard-form"]')).toBeNull();
  });

  it('renders a saved outline (paragraphs + a bracket) and its standard-form view', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getOutlineSpy.mockReturnValue(
      of(
        makeOutlineStudy({
          paragraphs: [
            { startRef: '1:1', endRef: '1:2', mainIdea: 'Greeting', notes: '' },
            { startRef: '1:3', endRef: '1:11', mainIdea: 'Thanksgiving', notes: 'n' },
          ],
          groupings: [{ column: 1, startIndex: 0, endIndex: 1, title: 'Opening', notes: '' }],
        }),
      ),
    );
    fixture.detectChanges();

    expect(queryAll('[data-testid="paragraph-row"]').length).toBe(2);
    expect(queryAll('[data-testid="grouping-block"]').length).toBe(1);
    expect(query('[data-testid="outline-standard-form"]')).not.toBeNull();
    // Standard form: bracket "I", paragraphs "A"/"B".
    const rows = queryAll('[data-testid="standard-row"]').map((e) => e.textContent?.trim());
    expect(rows.length).toBe(3);
    expect(rows[0]).toContain('I.');
    expect(rows[0]).toContain('Opening');
  });

  it('adds a paragraph, edits its fields, and removes it', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    component.addParagraph();
    component.setParagraphMainIdea(0, 'First idea');
    component.setParagraphStartRef(0, '1:1');
    component.setParagraphEndRef(0, '1:3');
    component.setParagraphNotes(0, 'why');
    expect(component.paragraphs()[0]).toEqual({
      startRef: '1:1',
      endRef: '1:3',
      mainIdea: 'First idea',
      notes: 'why',
    });

    component.removeParagraph(0);
    expect(component.paragraphs().length).toBe(0);
  });

  it('merges a contiguous selection into a column-1 bracket and rejects a non-adjacent one', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    component.addParagraph();
    component.addParagraph();
    component.addParagraph();
    component.setParagraphMainIdea(0, 'p0');
    component.setParagraphMainIdea(1, 'p1');
    component.setParagraphMainIdea(2, 'p2');

    // non-adjacent selection {0, 2} is not mergeable
    component.toggleSelect(0);
    component.toggleSelect(2);
    expect(component.canMergeSelection()).toBe(false);
    component.mergeSelection();
    expect(component.selectionError()).toBe(true);
    expect(component.groupings().length).toBe(0);

    // contiguous selection {0, 1} merges
    component.clearSelection();
    component.toggleSelect(0);
    component.toggleSelect(1);
    expect(component.canMergeSelection()).toBe(true);
    component.mergeSelection();
    expect(component.groupings()).toEqual([
      { column: 1, startIndex: 0, endIndex: 1, title: '', notes: '' },
    ]);
    expect(component.selection()).toEqual([]); // cleared after merge
  });

  it('titles a grouping and un-merges it', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    component.addParagraph();
    component.addParagraph();
    component.setParagraphMainIdea(0, 'p0');
    component.setParagraphMainIdea(1, 'p1');
    component.toggleSelect(0);
    component.toggleSelect(1);
    component.mergeSelection();

    component.setGroupingTitle(0, 'Bracket A');
    expect(component.groupings()[0].title).toBe('Bracket A');

    component.removeGrouping(0);
    expect(component.groupings().length).toBe(0);
    expect(component.paragraphs().length).toBe(2); // paragraphs untouched
  });

  it('groups two adjacent brackets into a column-2 grouping', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) {
      component.addParagraph();
      component.setParagraphMainIdea(i, `p${i}`);
    }
    // bracket [0,1]
    component.toggleSelect(0);
    component.toggleSelect(1);
    component.mergeSelection();
    // bracket [2,3]
    component.toggleSelect(2);
    component.toggleSelect(3);
    component.mergeSelection();
    expect(component.groupings().length).toBe(2);

    // promote the first bracket (ref 0): it has an adjacent same-column bracket at [2,3]
    expect(component.canPromote(0)).toBe(true);
    component.promoteGrouping(0);
    const col2 = component.groupings().filter((g) => g.column === 2);
    expect(col2).toEqual([{ column: 2, startIndex: 0, endIndex: 3, title: '', notes: '' }]);
  });

  it('shrinks a grouping span when a covered paragraph is removed', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    for (let i = 0; i < 3; i++) {
      component.addParagraph();
      component.setParagraphMainIdea(i, `p${i}`);
    }
    // bracket over 0..2
    component.toggleSelect(0);
    component.toggleSelect(1);
    component.toggleSelect(2);
    component.mergeSelection();
    expect(component.groupings()[0]).toMatchObject({ startIndex: 0, endIndex: 2 });

    component.removeParagraph(1); // removes a middle covered paragraph
    expect(component.paragraphs().length).toBe(2);
    expect(component.groupings()[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
  });

  it('drops a grouping that covered only the removed paragraph', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    for (let i = 0; i < 2; i++) {
      component.addParagraph();
      component.setParagraphMainIdea(i, `p${i}`);
    }
    // Build a 1-paragraph grouping by merging then removing the sibling is awkward; instead place a
    // grouping over [1,1] directly via a saved load, then remove paragraph 1.
    getOutlineSpy.mockReturnValue(
      of(
        makeOutlineStudy({
          paragraphs: [
            { startRef: '', endRef: '', mainIdea: 'p0', notes: '' },
            { startRef: '', endRef: '', mainIdea: 'p1', notes: '' },
          ],
          groupings: [{ column: 1, startIndex: 1, endIndex: 1, title: 'solo', notes: '' }],
        }),
      ),
    );
    component.load();
    fixture.detectChanges();
    expect(component.groupings().length).toBe(1);
    component.removeParagraph(1);
    expect(component.groupings().length).toBe(0);
  });

  it('does not move a paragraph when the move would split a grouping', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    for (let i = 0; i < 3; i++) {
      component.addParagraph();
      component.setParagraphMainIdea(i, `p${i}`);
    }
    // bracket over 0..1
    component.toggleSelect(0);
    component.toggleSelect(1);
    component.mergeSelection();

    // moving paragraph 1 (inside) down to index 2 (outside) would split the bracket → no-op
    component.moveParagraph(1, 1);
    expect(component.paragraphs().map((p) => p.mainIdea)).toEqual(['p0', 'p1', 'p2']);

    // moving paragraph 0 and 1 within the bracket is fine
    component.moveParagraph(0, 1);
    expect(component.paragraphs().map((p) => p.mainIdea)).toEqual(['p1', 'p0', 'p2']);
    expect(component.groupings()[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
  });

  it('offers import from Step 7 only when a structure has sections and the outline is empty', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getStructSpy.mockReturnValue(
      of(
        makeStructureStudy({
          sections: [
            { label: 'Opening', startRef: '1:1', endRef: '1:2', notes: 'greet' },
            { label: 'Body', startRef: '1:3', endRef: '4:1', notes: '' },
          ],
        }),
      ),
    );
    fixture.detectChanges();

    expect(component.canImport()).toBe(true);
    expect(query('[data-testid="outline-import"]')).not.toBeNull();

    component.importFromStep7();
    fixture.detectChanges();

    expect(component.paragraphs().map((p) => p.mainIdea)).toEqual(['Opening', 'Body']);
    expect(component.paragraphs()[0].startRef).toBe('1:1');
    expect(component.paragraphs()[0].notes).toBe('greet');
    expect(component.groupings().length).toBe(0);

    // once paragraphs exist, import is no longer offered and does not overwrite
    expect(component.canImport()).toBe(false);
    fixture.detectChanges();
    expect(query('[data-testid="outline-import"]')).toBeNull();
    component.importFromStep7();
    expect(component.paragraphs().length).toBe(2);
  });

  it('does not offer import when the structure has no sections', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getStructSpy.mockReturnValue(of(makeStructureStudy({ sections: [] })));
    fixture.detectChanges();
    expect(component.canImport()).toBe(false);
    expect(query('[data-testid="outline-import"]')).toBeNull();
  });

  it('saves, dropping empty-mainIdea paragraphs and empty-title groupings, and reflects the result', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    const normalised = makeOutlineStudy({
      paragraphs: [{ startRef: '', endRef: '', mainIdea: 'Kept', notes: '' }],
      groupings: [],
    });
    saveSpy.mockReturnValue(of(normalised));
    fixture.detectChanges();

    component.addParagraph();
    component.setParagraphMainIdea(0, 'Kept');
    component.addParagraph(); // empty mainIdea — dropped before send
    component.save();
    fixture.detectChanges();

    expect(saveSpy).toHaveBeenCalledWith('s1', {
      paragraphs: [{ startRef: '', endRef: '', mainIdea: 'Kept', notes: '' }],
      groupings: [],
    });
    expect(component.saved()).toBe(true);
    expect(component.paragraphs()).toEqual(normalised.paragraphs);
    expect(query('[data-testid="outline-saved"]')).not.toBeNull();
  });

  it('remaps grouping spans when an empty paragraph before them is dropped on save', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    saveSpy.mockImplementation((_id: string, input: unknown) => of(input));
    fixture.detectChanges();

    // p0 (empty, dropped), p1 'a', p2 'b' with a bracket over [1,2]
    component.addParagraph(); // index 0, empty
    component.addParagraph();
    component.setParagraphMainIdea(1, 'a');
    component.addParagraph();
    component.setParagraphMainIdea(2, 'b');
    component.toggleSelect(1);
    component.toggleSelect(2);
    component.mergeSelection();
    component.setGroupingTitle(0, 'Bracket');

    component.save();
    // On save, p0 is dropped; the bracket [1,2] should remap to [0,1].
    const call = saveSpy.mock.calls[0][1] as {
      paragraphs: unknown[];
      groupings: { startIndex: number; endIndex: number }[];
    };
    expect(call.paragraphs.length).toBe(2);
    expect(call.groupings[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
  });

  it('keeps entered values and shows an error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();

    component.addParagraph();
    component.setParagraphMainIdea(0, 'Still here');
    component.save();
    fixture.detectChanges();

    expect(component.saveError()).toBe(true);
    expect(component.paragraphs()[0].mainIdea).toBe('Still here');
    expect(query('[data-testid="outline-save-error"]')).not.toBeNull();
  });

  it('shows the preparing state for an uploading/extracting scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ status: 'extracting', scrollText: '' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
    expect(query('[data-testid="outline-preparing"]')).not.toBeNull();
  });

  it('shows the failed state for a failed scroll with its reason', () => {
    configure();
    getScrollSpy.mockReturnValue(
      of(makeStudy({ status: 'failed', failureReason: 'file too large', scrollText: '' })),
    );
    fixture.detectChanges();
    expect(component.state()).toBe('failed');
    expect(query('[data-testid="outline-failed"]')?.textContent).toContain('file too large');
  });

  it('shows the failed state on a 404 and the error state (with Retry) on a transient error', () => {
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 404 })));
    fixture.detectChanges();
    expect(component.state()).toBe('failed');

    TestBed.resetTestingModule();
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();
    expect(component.state()).toBe('error');
    expect(query('[data-testid="outline-retry-button"]')).not.toBeNull();
  });

  it('calls the scroll, outline, and structure services once each on load', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    expect(getScrollSpy).toHaveBeenCalledTimes(1);
    expect(getOutlineSpy).toHaveBeenCalledTimes(1);
    expect(getStructSpy).toHaveBeenCalledTimes(1);
  });
});
