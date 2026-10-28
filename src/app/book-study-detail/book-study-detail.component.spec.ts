import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { BookStudyDetailComponent } from './book-study-detail.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { environment } from '../environment';

/** Scrolls the mocked ScrollStudyService.listScrollStudies() returns; override per test. */
let mockScrolls: ScrollStudy[] = [];

function makeScroll(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookStudyId: 'b1',
    bookName: 'John',
    status: 'ready',
    scrollText: 'text',
    truncated: false,
    failureReason: '',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function configure(bookStudyId: string) {
  const mockScrollService: Partial<ScrollStudyService> = {
    listScrollStudies: (() =>
      of(mockScrolls)) as unknown as ScrollStudyService['listScrollStudies'],
  };
  TestBed.configureTestingModule({
    imports: [BookStudyDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ScrollStudyService, useValue: mockScrollService },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ bookStudyId }) } },
      },
    ],
  });
}

describe('BookStudyDetailComponent', () => {
  let fixture: ComponentFixture<BookStudyDetailComponent>;
  let component: BookStudyDetailComponent;
  let httpTesting: HttpTestingController;

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function createWith(bookStudyId: string) {
    configure(bookStudyId);
    fixture = TestBed.createComponent(BookStudyDetailComponent);
    component = fixture.componentInstance;
    httpTesting = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // ngOnInit
  }

  beforeEach(() => {
    mockScrolls = [];
    TestBed.resetTestingModule();
  });

  it('should render book, title, notes and timestamps on success', () => {
    createWith('b1');

    const req = httpTesting.expectOne(`${environment.apiUrl}/books/b1`);
    expect(req.request.method).toBe('GET');
    req.flush({
      bookStudyId: 'b1',
      userId: 'u1',
      book: 'Genesis',
      title: 'My study',
      notes: 'line one\nline two',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    });
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(query('[data-testid="detail-book"]')!.textContent).toContain('Genesis');
    expect(query('[data-testid="detail-title"]')!.textContent).toContain('My study');
    expect(query('[data-testid="detail-notes"]')!.textContent).toContain('line one');
    expect(query('[data-testid="detail-timestamps"]')).not.toBeNull();
  });

  it('should show a not-found message with a back link on 404', () => {
    createWith('missing');

    const req = httpTesting.expectOne(`${environment.apiUrl}/books/missing`);
    req.flush('Not found', { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(component.state()).toBe('notfound');
    const notFound = query('[data-testid="not-found"]');
    expect(notFound).not.toBeNull();
    // Back link to /books is present in the template.
    expect(query('[data-testid="back-link"]')).not.toBeNull();
  });

  it('should delete after confirmation and navigate back to /books', () => {
    createWith('b1');

    const getReq = httpTesting.expectOne(`${environment.apiUrl}/books/b1`);
    getReq.flush({
      bookStudyId: 'b1',
      userId: 'u1',
      book: 'John',
      title: '',
      notes: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    (query('[data-testid="delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).not.toBeNull();

    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();

    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/books/b1`,
    );
    deleteReq.flush(null);

    expect(navigateSpy).toHaveBeenCalledWith(['/books']);
  });

  // --- Referents section ---

  function queryAll(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  function flushLoad(
    bookStudyId: string,
    referents?: unknown,
    overrides: Record<string, unknown> = {},
  ) {
    const req = httpTesting.expectOne(`${environment.apiUrl}/books/${bookStudyId}`);
    req.flush({
      bookStudyId,
      userId: 'u1',
      book: 'John',
      title: '',
      notes: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      ...(referents !== undefined ? { referents } : {}),
      ...overrides,
    });
    fixture.detectChanges();
    // Referents editor now lives behind the Step 6 disclosure; open it for these DOM assertions.
    component.referentsOpen.set(true);
    fixture.detectChanges();
  }

  it('renders the empty state when the study has no referents', () => {
    createWith('b1');
    flushLoad('b1', []);

    expect(query('[data-testid="referents-section"]')).not.toBeNull();
    expect(query('[data-testid="referents-empty"]')).not.toBeNull();
    expect(queryAll('[data-testid="referent-row"]').length).toBe(0);
  });

  it('renders existing referents as rows', () => {
    createWith('b1');
    flushLoad('b1', [
      { phrase: 'the ruler of this world', refersTo: 'Satan', notes: 'John 12', scrollRef: '' },
      { phrase: 'the Lamb', refersTo: 'Jesus', notes: '', scrollRef: 'ch. 5' },
    ]);

    expect(query('[data-testid="referents-empty"]')).toBeNull();
    expect(queryAll('[data-testid="referent-row"]').length).toBe(2);
    expect(component.referents()[0].phrase).toBe('the ruler of this world');
  });

  it('appends a valid add and clears the form', () => {
    createWith('b1');
    flushLoad('b1', []);

    component.draftPhrase = 'the Word';
    component.draftRefersTo = 'Jesus';
    component.draftNotes = 'prologue';
    fixture.detectChanges();

    (query('[data-testid="add-referent-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.referents().length).toBe(1);
    expect(component.referents()[0]).toEqual({
      phrase: 'the Word',
      refersTo: 'Jesus',
      notes: 'prologue',
      scrollRef: '',
    });
    // form cleared
    expect(component.draftPhrase).toBe('');
    expect(component.draftRefersTo).toBe('');
    expect(component.draftNotes).toBe('');
    expect(query('[data-testid="add-referent-error"]')).toBeNull();
  });

  it('blocks the add and shows the inline error when the phrase is empty', () => {
    createWith('b1');
    flushLoad('b1', []);

    component.draftRefersTo = 'Jesus';
    fixture.detectChanges();
    (query('[data-testid="add-referent-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.referents().length).toBe(0);
    expect(query('[data-testid="add-referent-error"]')).not.toBeNull();
  });

  it('blocks the add and shows the inline error when refers-to is empty', () => {
    createWith('b1');
    flushLoad('b1', []);

    component.draftPhrase = 'the Word';
    fixture.detectChanges();
    (query('[data-testid="add-referent-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.referents().length).toBe(0);
    expect(query('[data-testid="add-referent-error"]')).not.toBeNull();
  });

  it('updates an entry notes/scrollRef in place', () => {
    createWith('b1');
    flushLoad('b1', [{ phrase: 'p', refersTo: 'r', notes: '', scrollRef: '' }]);

    component.updateReferent(0, 'notes', 'new note');
    component.updateReferent(0, 'scrollRef', 'ch. 3');
    fixture.detectChanges();

    expect(component.referents()[0].notes).toBe('new note');
    expect(component.referents()[0].scrollRef).toBe('ch. 3');
  });

  it('edits a phrase in place without changing its position', () => {
    createWith('b1');
    flushLoad('b1', [
      { phrase: 'first', refersTo: 'a', notes: '', scrollRef: '' },
      { phrase: 'second', refersTo: 'b', notes: '', scrollRef: '' },
    ]);

    component.updateReferent(0, 'phrase', 'first edited');
    fixture.detectChanges();

    expect(component.referents().length).toBe(2);
    expect(component.referents()[0].phrase).toBe('first edited');
    expect(component.referents()[1].phrase).toBe('second');
    expect(query('[data-testid="add-referent-error"]')).toBeNull();
  });

  it('rejects an in-place edit that blanks a required field and keeps the prior value', () => {
    createWith('b1');
    flushLoad('b1', [{ phrase: 'keep me', refersTo: 'r', notes: '', scrollRef: '' }]);

    component.updateReferent(0, 'phrase', '   ');
    fixture.detectChanges();

    expect(component.referents()[0].phrase).toBe('keep me');
    expect(query('[data-testid="add-referent-error"]')).not.toBeNull();
  });

  it('removes an entry', () => {
    createWith('b1');
    flushLoad('b1', [
      { phrase: 'a', refersTo: '1', notes: '', scrollRef: '' },
      { phrase: 'b', refersTo: '2', notes: '', scrollRef: '' },
    ]);

    (queryAll('[data-testid="remove-referent-button"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.referents().length).toBe(1);
    expect(component.referents()[0].phrase).toBe('b');
  });

  it('saves via BookStudyService.save and advances the displayed Updated timestamp', () => {
    createWith('b1');
    flushLoad('b1', [{ phrase: 'p', refersTo: 'r', notes: '', scrollRef: '' }]);

    const before = query('[data-testid="detail-timestamps"]')!.textContent ?? '';
    const beforeUpdated = component.bookStudy()!.updatedAt;

    (query('[data-testid="save-referents-button"]') as HTMLButtonElement).click();

    const saveReq = httpTesting.expectOne(
      (r) => r.method === 'POST' && r.url === `${environment.apiUrl}/books`,
    );
    expect(saveReq.request.body).toEqual({
      id: 'b1',
      book: 'John',
      title: '',
      notes: '',
      referents: [{ phrase: 'p', refersTo: 'r', notes: '', scrollRef: '' }],
    });
    saveReq.flush({ bookStudyId: 'b1' });
    fixture.detectChanges();

    expect(component.saveState()).toBe('saved');
    expect(query('[data-testid="referents-saved"]')).not.toBeNull();
    // Updated timestamp advanced (no extra GET needed).
    expect(new Date(component.bookStudy()!.updatedAt).getTime()).toBeGreaterThan(
      new Date(beforeUpdated).getTime(),
    );
    expect(query('[data-testid="detail-timestamps"]')!.textContent).not.toBe(before);
    // No pending HTTP request after save (no re-GET).
    httpTesting.verify();
  });

  it('keeps the working list and shows an error when a save fails', () => {
    createWith('b1');
    flushLoad('b1', [{ phrase: 'p', refersTo: 'r', notes: '', scrollRef: '' }]);

    (query('[data-testid="save-referents-button"]') as HTMLButtonElement).click();

    const saveReq = httpTesting.expectOne(
      (r) => r.method === 'POST' && r.url === `${environment.apiUrl}/books`,
    );
    saveReq.flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.saveState()).toBe('error');
    expect(query('[data-testid="referents-save-error"]')).not.toBeNull();
    // working list retained for retry
    expect(component.referents().length).toBe(1);
  });

  it('defaults referents to [] on a legacy record with no referents attribute', () => {
    createWith('b1');
    flushLoad('b1'); // no referents key

    expect(component.referents()).toEqual([]);
    // Referents live behind the Step 6 disclosure now; flushLoad opened it.
    expect(query('[data-testid="referents-empty"]')).not.toBeNull();
  });

  // --- Study steps hub ---

  /** Flush the book GET without opening the referents disclosure (hub-level assertions). */
  function flushBook(bookStudyId: string, overrides: Record<string, unknown> = {}) {
    const req = httpTesting.expectOne(`${environment.apiUrl}/books/${bookStudyId}`);
    req.flush({
      bookStudyId,
      userId: 'u1',
      book: 'John',
      title: '',
      notes: '',
      referents: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      ...overrides,
    });
    fixture.detectChanges();
  }

  it('shows the upload-scroll action when no scroll is linked', () => {
    mockScrolls = [];
    createWith('b1');
    flushBook('b1');

    expect(query('[data-testid="steps-section"]')).not.toBeNull();
    expect(query('[data-testid="no-scroll"]')).not.toBeNull();
    expect(query('[data-testid="upload-scroll-button"]')).not.toBeNull();
    expect(query('[data-testid="scroll-linked"]')).toBeNull();
  });

  it('navigates to /scroll/new with the bookStudyId when uploading the scroll', () => {
    mockScrolls = [];
    createWith('b1');
    flushBook('b1');

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');
    (query('[data-testid="upload-scroll-button"]') as HTMLButtonElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/scroll/new'], {
      queryParams: { bookStudyId: 'b1' },
    });
  });

  it('renders step deep-links when a ready scroll is linked', () => {
    mockScrolls = [makeScroll({ id: 's9', bookStudyId: 'b1', status: 'ready' })];
    createWith('b1');
    flushBook('b1');

    expect(query('[data-testid="scroll-linked"]')).not.toBeNull();
    expect(query('[data-testid="no-scroll"]')).toBeNull();
    const links = query('[data-testid="step-links"]');
    expect(links).not.toBeNull();
    const open = query('[data-testid="open-scroll-link"]') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe('/scroll/s9');
    const theme = query('[data-testid="theme-purpose-link"]') as HTMLAnchorElement;
    expect(theme.getAttribute('href')).toBe('/scroll/s9/outline');
    const figures = query('[data-testid="figures-link"]') as HTMLAnchorElement;
    expect(figures.getAttribute('href')).toBe('/scroll/s9/figures');
    const interrogate = query('[data-testid="interrogate-link"]') as HTMLAnchorElement;
    expect(interrogate.getAttribute('href')).toBe('/scroll/s9/interrogate');
  });

  it('gates steps 6–9 while the linked scroll is not ready', () => {
    mockScrolls = [makeScroll({ id: 's9', bookStudyId: 'b1', status: 'extracting' })];
    createWith('b1');
    flushBook('b1');

    expect(query('[data-testid="scroll-linked"]')).not.toBeNull();
    expect(query('[data-testid="step-links"]')).toBeNull();
    expect(query('[data-testid="steps-pending"]')).not.toBeNull();
  });

  it('ignores a scroll linked to a different book study', () => {
    mockScrolls = [makeScroll({ id: 'sX', bookStudyId: 'other-book' })];
    createWith('b1');
    flushBook('b1');

    expect(component.linkedScroll()).toBeNull();
    expect(query('[data-testid="no-scroll"]')).not.toBeNull();
  });

  it('toggles the referents editor from the Step 6 entry', () => {
    mockScrolls = [makeScroll({ id: 's9', bookStudyId: 'b1', status: 'ready' })];
    createWith('b1');
    flushBook('b1');

    expect(query('[data-testid="referents-section"]')).toBeNull();
    (query('[data-testid="toggle-referents"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.referentsOpen()).toBe(true);
    expect(query('[data-testid="referents-section"]')).not.toBeNull();
  });
});
