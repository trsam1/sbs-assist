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
    nodes: [],
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
    expect(query('[data-testid="outline-nodes"]')).not.toBeNull();
    expect(query('[data-testid="outline-empty"]')).not.toBeNull();
    expect(queryAll('[data-testid="node-row"]').length).toBe(0);
    // no Step 7 structure → no import affordance, no standard-form box
    expect(query('[data-testid="outline-import"]')).toBeNull();
    expect(query('[data-testid="outline-standard-form"]')).toBeNull();
  });

  it('renders a saved outline and its standard-form view', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getOutlineSpy.mockReturnValue(
      of(
        makeOutlineStudy({
          nodes: [
            { title: 'Greeting', level: 0, startRef: '1:1', endRef: '1:2', notes: '' },
            { title: 'Thanksgiving', level: 1, startRef: '1:3', endRef: '1:11', notes: 'n' },
          ],
        }),
      ),
    );
    fixture.detectChanges();

    expect(queryAll('[data-testid="node-row"]').length).toBe(2);
    const labels = queryAll('[data-testid="node-label"]').map((e) => e.textContent?.trim());
    expect(labels).toEqual(['I', 'A']);
    // standard-form box present with a row per node
    expect(query('[data-testid="outline-standard-form"]')).not.toBeNull();
    expect(queryAll('[data-testid="standard-row"]').length).toBe(2);
  });

  it('adds a node inheriting the previous node level, titles it, and removes it', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    component.addNode();
    component.setNodeTitle(0, 'First');
    expect(component.nodes()[0]).toEqual({
      title: 'First',
      level: 0,
      startRef: '',
      endRef: '',
      notes: '',
    });

    component.indentNode(0); // level 0 → 1
    component.addNode(); // new node inherits previous node's level (1)
    expect(component.nodes()[1].level).toBe(1);

    component.removeNode(0);
    expect(component.nodes().length).toBe(1);
    expect(component.nodes()[0].level).toBe(1);
  });

  it('edits title/startRef/endRef/notes on a single node only', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    component.addNode();
    component.addNode();
    component.setNodeTitle(1, 'Second');
    component.setNodeStartRef(1, '2:1');
    component.setNodeEndRef(1, '2:4');
    component.setNodeNotes(1, 'why');

    expect(component.nodes()[0]).toEqual({
      title: '',
      level: 0,
      startRef: '',
      endRef: '',
      notes: '',
    });
    expect(component.nodes()[1]).toEqual({
      title: 'Second',
      level: 0,
      startRef: '2:1',
      endRef: '2:4',
      notes: 'why',
    });
  });

  it('moves nodes up and down preserving level', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    component.addNode();
    component.setNodeTitle(0, 'A');
    component.addNode();
    component.setNodeTitle(1, 'B');
    component.indentNode(1);

    component.moveNode(1, -1);
    expect(component.nodes().map((n) => n.title)).toEqual(['B', 'A']);
    expect(component.nodes()[0].level).toBe(1); // B kept its level through the move
  });

  it('clamps indent at MAX_LEVEL and outdent at 0', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    component.addNode();
    for (let i = 0; i < 10; i++) component.indentNode(0);
    expect(component.nodes()[0].level).toBe(component.maxLevel);

    for (let i = 0; i < 10; i++) component.outdentNode(0);
    expect(component.nodes()[0].level).toBe(0);
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

    expect(component.nodes().map((n) => ({ title: n.title, level: n.level }))).toEqual([
      { title: 'Opening', level: 0 },
      { title: 'Body', level: 0 },
    ]);
    // refs/notes carry over
    expect(component.nodes()[0].startRef).toBe('1:1');
    expect(component.nodes()[0].notes).toBe('greet');
    // once nodes exist, import is no longer offered and does not overwrite
    expect(component.canImport()).toBe(false);
    fixture.detectChanges();
    expect(query('[data-testid="outline-import"]')).toBeNull();
    component.importFromStep7();
    expect(component.nodes().length).toBe(2);
  });

  it('does not offer import when the structure has no sections', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getStructSpy.mockReturnValue(of(makeStructureStudy({ sections: [] })));
    fixture.detectChanges();
    expect(component.canImport()).toBe(false);
    expect(query('[data-testid="outline-import"]')).toBeNull();
  });

  it('saves, dropping empty-title nodes, and reflects the normalised result', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    const normalised = makeOutlineStudy({
      nodes: [{ title: 'Kept', level: 0, startRef: '', endRef: '', notes: '' }],
    });
    saveSpy.mockReturnValue(of(normalised));
    fixture.detectChanges();

    component.addNode();
    component.setNodeTitle(0, 'Kept');
    component.addNode(); // empty title — should be dropped before send
    component.save();
    fixture.detectChanges();

    expect(saveSpy).toHaveBeenCalledWith('s1', {
      nodes: [{ title: 'Kept', level: 0, startRef: '', endRef: '', notes: '' }],
    });
    expect(component.saved()).toBe(true);
    expect(component.nodes()).toEqual(normalised.nodes);
    expect(query('[data-testid="outline-saved"]')).not.toBeNull();
  });

  it('keeps entered values and shows an error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();

    component.addNode();
    component.setNodeTitle(0, 'Still here');
    component.save();
    fixture.detectChanges();

    expect(component.saveError()).toBe(true);
    expect(component.nodes()[0].title).toBe('Still here');
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
