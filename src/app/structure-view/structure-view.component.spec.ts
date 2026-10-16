import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { StructureViewComponent } from './structure-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { StructureStudyService } from '../structure-study.service';
import { StructureStudy } from '../models';

function makeStudy(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookName: 'Philippians',
    status: 'ready',
    scrollText: 'Finally brethren rejoice. Rejoice always. Therefore stand firm, beloved.',
    truncated: false,
    failureReason: '',
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

describe('StructureViewComponent', () => {
  let fixture: ComponentFixture<StructureViewComponent>;
  let component: StructureViewComponent;
  let getScrollSpy: ReturnType<typeof vi.fn>;
  let getStructSpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    getScrollSpy = vi.fn();
    getStructSpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    saveSpy = vi.fn().mockReturnValue(of(makeStructureStudy()));
    const scrollService: Partial<ScrollStudyService> = {
      getScrollStudy: getScrollSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    const structService: Partial<StructureStudyService> = {
      get: getStructSpy as unknown as StructureStudyService['get'],
      save: saveSpy as unknown as StructureStudyService['save'],
    };
    TestBed.configureTestingModule({
      imports: [StructureViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: StructureStudyService, useValue: structService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(StructureViewComponent);
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

  it('renders the frequency view and marker candidates for a ready scroll with no saved study', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    expect(component.state()).toBe('ready');
    expect(query('[data-testid="structure-frequency"]')).not.toBeNull();
    // "rejoice" repeats and is a content word → appears in the (default-filtered) frequency view.
    const words = queryAll('[data-testid="frequency-word"]').map((e) => e.textContent?.trim());
    expect(words).toContain('rejoice');
    // candidates surface "finally"/"therefore"/"brethren"/"beloved" signal phrases.
    expect(queryAll('[data-testid="marker-candidate"]').length).toBeGreaterThan(0);
    // empty editable worksheet: no markers/sections yet.
    expect(queryAll('[data-testid="marker-row"]').length).toBe(0);
  });

  it('hides common words by default and shows them when the stop-word toggle is off', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ scrollText: 'the the the grace grace' })));
    fixture.detectChanges();

    let words = queryAll('[data-testid="frequency-word"]').map((e) => e.textContent?.trim());
    expect(words).toContain('grace');
    expect(words).not.toContain('the');

    component.setStopWords(false);
    fixture.detectChanges();
    words = queryAll('[data-testid="frequency-word"]').map((e) => e.textContent?.trim());
    expect(words).toContain('the');
  });

  it('renders a saved study genre/tone/markers/sections', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getStructSpy.mockReturnValue(
      of(
        makeStructureStudy({
          genre: 'letter',
          tone: 'joyful',
          markers: [{ kind: 'transition', phrase: 'Finally', ref: '0', notes: '' }],
          sections: [{ label: 'Thanksgiving', startRef: '1:3', endRef: '1:11', notes: '' }],
        }),
      ),
    );
    fixture.detectChanges();

    expect(component.genre()).toBe('letter');
    expect(component.tone()).toBe('joyful');
    expect(queryAll('[data-testid="marker-row"]').length).toBe(1);
    expect(queryAll('[data-testid="section-row"]').length).toBe(1);
    expect(query('[data-testid="divisions-reminder"]')?.textContent).toMatch(/uninspired/i);
  });

  it('accepts a candidate as a marker and adds a manual marker', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    const before = component.markers().length;
    component.acceptCandidate(component.candidates()[0]);
    expect(component.markers().length).toBe(before + 1);

    component.newMarkerPhrase.set('new section here');
    component.newMarkerKind.set('declarative');
    component.addMarker();
    expect(component.markers().some((m) => m.phrase === 'new section here')).toBe(true);
    // empty phrase does not add
    const n = component.markers().length;
    component.newMarkerPhrase.set('   ');
    component.addMarker();
    expect(component.markers().length).toBe(n);
  });

  it('adds, reorders, and removes sections preserving order', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    component.addSection();
    component.setSectionLabel(0, 'A');
    component.addSection();
    component.setSectionLabel(1, 'B');
    expect(component.sections().map((s) => s.label)).toEqual(['A', 'B']);

    component.moveSection(1, -1);
    expect(component.sections().map((s) => s.label)).toEqual(['B', 'A']);

    component.removeSection(0);
    expect(component.sections().map((s) => s.label)).toEqual(['A']);
  });

  it('saves and shows a confirmation, calling the service', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    saveSpy.mockReturnValue(of(makeStructureStudy({ genre: 'letter' })));
    fixture.detectChanges();

    component.genre.set('letter');
    component.save();
    fixture.detectChanges();

    expect(saveSpy).toHaveBeenCalledWith('s1', expect.objectContaining({ genre: 'letter' }));
    expect(component.saved()).toBe(true);
    expect(query('[data-testid="structure-saved"]')).not.toBeNull();
  });

  it('keeps entered values and shows an error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();

    component.genre.set('poetry');
    component.save();
    fixture.detectChanges();

    expect(component.saveError()).toBe(true);
    expect(component.genre()).toBe('poetry');
    expect(query('[data-testid="structure-save-error"]')).not.toBeNull();
  });

  it('shows the empty-state box for a ready scroll with no words', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ scrollText: '   \n 123 ' })));
    fixture.detectChanges();
    expect(query('[data-testid="structure-empty"]')).not.toBeNull();
  });

  it('shows the preparing state for an uploading/extracting scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ status: 'extracting', scrollText: '' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
    expect(query('[data-testid="structure-preparing"]')).not.toBeNull();
  });

  it('shows the failed state for a failed scroll with its reason', () => {
    configure();
    getScrollSpy.mockReturnValue(
      of(makeStudy({ status: 'failed', failureReason: 'file too large', scrollText: '' })),
    );
    fixture.detectChanges();
    expect(component.state()).toBe('failed');
    expect(query('[data-testid="structure-failed"]')?.textContent).toContain('file too large');
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
    expect(query('[data-testid="structure-retry-button"]')).not.toBeNull();
  });

  it('calls only the scroll and structure services (no unexpected API dependency)', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();
    expect(getScrollSpy).toHaveBeenCalledTimes(1);
    expect(getStructSpy).toHaveBeenCalledTimes(1);
  });
});
