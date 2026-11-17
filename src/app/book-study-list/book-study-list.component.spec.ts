import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookStudyListComponent } from './book-study-list.component';
import { BookStudy } from '../models';
import { environment } from '../environment';

function makeBookStudy(overrides: Partial<BookStudy> = {}): BookStudy {
  return {
    id: 'b1',
    userId: 'u1',
    book: 'Genesis',
    title: 'My Genesis study',
    notes: '',
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-02T12:00:00.000Z',
    referents: [],
    ...overrides,
  };
}

describe('BookStudyListComponent', () => {
  let fixture: ComponentFixture<BookStudyListComponent>;
  let component: BookStudyListComponent;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookStudyListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(BookStudyListComponent);
    component = fixture.componentInstance;
  });

  function getHttpTesting(): HttpTestingController {
    return TestBed.inject(HttpTestingController);
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function queryAll(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show loading state on init', () => {
    fixture.detectChanges();
    expect(component.state()).toBe('loading');
    expect(query('[data-testid="loading"]')).not.toBeNull();
  });

  it('should display book studies after successful fetch', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const studies = [
      makeBookStudy({ id: 'b1', book: 'Genesis', title: 'Genesis study' }),
      makeBookStudy({ id: 'b2', book: 'John', title: '' }),
    ];

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    req.flush(studies);
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(queryAll('[data-testid="book-study-row"]').length).toBe(2);

    const titles = queryAll('[data-testid="book-study-title"]').map((el) => el.textContent?.trim());
    // Second row falls back to the book name because its title is empty.
    expect(titles).toEqual(['Genesis study', 'John']);

    const books = queryAll('[data-testid="book-study-book"]').map((el) => el.textContent?.trim());
    expect(books).toEqual(['Genesis', 'John']);
  });

  it('should show empty state when no book studies exist', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    req.flush([]);
    fixture.detectChanges();

    expect(query('[data-testid="empty-state"]')).not.toBeNull();
    expect(query('[data-testid="empty-state"]')!.textContent).toContain('No book studies yet');
  });

  it('should show error state and retry on fetch failure', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req1 = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    req1.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    const retryBtn = query('[data-testid="retry-button"]') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    retryBtn.click();
    fixture.detectChanges();

    const req2 = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    req2.flush([makeBookStudy()]);
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(queryAll('[data-testid="book-study-row"]').length).toBe(1);
  });

  it('should navigate to /books/new when New Book Study is clicked', () => {
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    (query('[data-testid="new-book-study-button"]') as HTMLButtonElement).click();
    expect(navigateSpy).toHaveBeenCalledWith(['/books/new']);
  });

  it('should navigate to the detail route when Open is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    req.flush([makeBookStudy({ id: 'open-me' })]);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    (query('[data-testid="open-book-study-button"]') as HTMLButtonElement).click();
    expect(navigateSpy).toHaveBeenCalledWith(['/books', 'open-me']);
  });

  it('should show confirmation modal with alertdialog role when Delete is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    req.flush([makeBookStudy({ id: 'b1', book: 'Genesis', title: 'Genesis study' })]);
    fixture.detectChanges();

    expect(query('[data-testid="delete-modal"]')).toBeNull();

    (query('[data-testid="delete-book-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const modal = query('[data-testid="delete-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('Genesis study');
    expect(modal!.textContent).toContain('Genesis');

    const modalCard = query('[role="alertdialog"]');
    expect(modalCard).not.toBeNull();
    expect(modalCard!.getAttribute('aria-modal')).toBe('true');
    expect(modalCard!.getAttribute('aria-labelledby')).toBe('delete-modal-title');
  });

  it('should close the modal when Cancel is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    req.flush([makeBookStudy({ id: 'b1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-book-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).not.toBeNull();

    (query('[data-testid="cancel-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).toBeNull();
  });

  it('should delete a book study and remove it from the list on confirm', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const studies = [makeBookStudy({ id: 'b1' }), makeBookStudy({ id: 'b2' })];
    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    listReq.flush(studies);
    fixture.detectChanges();

    expect(queryAll('[data-testid="book-study-row"]').length).toBe(2);

    (queryAll('[data-testid="delete-book-study-button"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/books/b1`,
    );
    deleteReq.flush(null);
    fixture.detectChanges();

    expect(query('[data-testid="delete-modal"]')).toBeNull();
    expect(queryAll('[data-testid="book-study-row"]').length).toBe(1);
    expect(component.bookStudies().length).toBe(1);
    expect(component.bookStudies()[0].id).toBe('b2');
  });

  it('should keep the row and show a dismissible error when delete fails', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/books`);
    listReq.flush([makeBookStudy({ id: 'b1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-book-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/books/b1`,
    );
    deleteReq.flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(query('[data-testid="delete-modal"]')).toBeNull();
    expect(queryAll('[data-testid="book-study-row"]').length).toBe(1);
    const errorNotif = query('[data-testid="delete-error"]');
    expect(errorNotif).not.toBeNull();
    expect(errorNotif!.textContent).toContain('Failed to delete book study');
  });

  describe('search', () => {
    function loadBooks(): void {
      fixture.detectChanges();
      httpTesting = getHttpTesting();
      httpTesting
        .expectOne((r) => r.url === `${environment.apiUrl}/books`)
        .flush([
          makeBookStudy({ id: 'b1', book: 'Romans', title: 'Grace', notes: 'justification' }),
          makeBookStudy({ id: 'b2', book: 'John', title: '', notes: 'the Word' }),
        ]);
      fixture.detectChanges();
    }

    function type(text: string): void {
      const input = query('[data-testid="books-search"]') as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    const word = (id: string, w: string, strongs: string, notes = '') => ({
      id,
      userId: 'u',
      createdAt: '',
      updatedAt: '',
      bookStudyIds: [],
      wordStudies: [
        {
          word: w,
          strongsNumber: strongs,
          notes,
          definitionNotes: '',
          strongsNotes: '',
          lexiconNotes: '',
        },
      ],
    });

    it('does not load word studies until something is searched', () => {
      loadBooks();
      httpTesting.expectNone(`${environment.apiUrl}/studies`);
    });

    it('filters books by name, title or notes, ignoring case and accents', () => {
      loadBooks();
      type('GRACE');
      expect(queryAll('[data-testid="book-study-row"]').length).toBe(1);
      type('word');
      expect(queryAll('[data-testid="book-study-row"]').length).toBe(1);
      expect(query('[data-testid="book-study-book"]')?.textContent).toContain('John');
      type('');
      expect(queryAll('[data-testid="book-study-row"]').length).toBe(2);
    });

    it('says so when no book matches', () => {
      loadBooks();
      type('zzz');
      expect(query('[data-testid="no-book-matches"]')).not.toBeNull();
    });

    it('loads word studies once and lists the ones that match, with a link', () => {
      loadBooks();
      type('gr');
      httpTesting
        .expectOne(`${environment.apiUrl}/studies`)
        .flush([word('w1', 'grace', 'G5485', 'favor'), word('w2', 'faith', 'G4102')]);
      fixture.detectChanges();
      expect(queryAll('[data-testid="word-study-match"]').length).toBe(1);
      const link = query('[data-testid="word-study-match"] a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/study/w1');

      type('grace f'); // a second search does not call the API again
      httpTesting.expectNone(`${environment.apiUrl}/studies`);
      expect(queryAll('[data-testid="word-study-match"]').length).toBe(1);
    });

    it("matches a word study by Strong's number", () => {
      loadBooks();
      type('G4102');
      httpTesting.expectOne(`${environment.apiUrl}/studies`).flush([word('w2', 'faith', 'G4102')]);
      fixture.detectChanges();
      expect(query('[data-testid="word-study-match"]')?.textContent).toContain('faith');
    });

    it('still filters books when the word study list cannot be loaded', () => {
      loadBooks();
      type('romans');
      httpTesting
        .expectOne(`${environment.apiUrl}/studies`)
        .flush('x', { status: 500, statusText: 'err' });
      fixture.detectChanges();
      expect(queryAll('[data-testid="book-study-row"]').length).toBe(1);
      expect(query('[data-testid="word-study-matches"]')).toBeNull();
    });
  });
});
