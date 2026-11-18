import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StudyListComponent } from './study-list.component';
import { StudyWorksheet } from '../models';
import { environment } from '../environment';

function makeStudy(overrides: Partial<StudyWorksheet> = {}): StudyWorksheet {
  return {
    id: 'study-1',
    userId: 'anonymous',
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-02T12:00:00.000Z',
    bookStudyIds: [],
    wordStudies: [
      {
        word: 'love',
        strongsNumber: 'G25',
        englishDefinition: {
          word: 'love',
          meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }],
        },
        strongsDefinition: 'to love',
        originalWord: 'ἀγαπάω',
        transliteration: 'agapaō',
        lexiconEntry: 'From ἀγάπη; to love...',
        crossReferences: [],
        aiSummary: '',
        notes: '',
        definitionNotes: '',
        strongsNotes: '',
        lexiconNotes: '',
      },
    ],
    ...overrides,
  };
}

describe('StudyListComponent', () => {
  let fixture: ComponentFixture<StudyListComponent>;
  let component: StudyListComponent;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudyListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(StudyListComponent);
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
    fixture.detectChanges(); // triggers ngOnInit
    expect(component.state()).toBe('loading');
    expect(query('[data-testid="loading"]')).not.toBeNull();
  });

  it('should display studies after successful fetch', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const studies = [
      makeStudy({ id: 's1' }),
      makeStudy({
        id: 's2',
        wordStudies: [
          {
            word: 'faith',
            strongsNumber: 'G4102',
            englishDefinition: null,
            strongsDefinition: 'persuasion',
            originalWord: 'πίστις',
            transliteration: 'pistis',
            lexiconEntry: '',
            crossReferences: [],
            aiSummary: '',
            notes: '',
            definitionNotes: '',
            strongsNotes: '',
            lexiconNotes: '',
          },
        ],
      }),
    ];

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush(studies);
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(queryAll('[data-testid="study-row"]').length).toBe(2);

    const words = queryAll('[data-testid="study-word"]').map((el) => el.textContent?.trim());
    expect(words).toEqual(['love', 'faith']);

    const strongs = queryAll('[data-testid="study-strongs"]').map((el) => el.textContent?.trim());
    expect(strongs).toEqual(['G25', 'G4102']);
  });

  it('should show empty state when no studies exist', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([]);
    fixture.detectChanges();

    expect(query('[data-testid="empty-state"]')).not.toBeNull();
    expect(query('[data-testid="empty-state"]')!.textContent).toContain('No saved studies yet');
  });

  it('should show error state on fetch failure', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    expect(query('[data-testid="error"]')).not.toBeNull();
  });

  it('should retry loading when retry button is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    // First request fails
    const req1 = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req1.flush('Error', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    // Click retry
    const retryBtn = query('[data-testid="retry-button"]') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    retryBtn.click();
    fixture.detectChanges();

    // Second request succeeds
    const req2 = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req2.flush([makeStudy()]);
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(queryAll('[data-testid="study-row"]').length).toBe(1);
  });

  it('should display dash for word when wordStudies is empty', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ wordStudies: [] })]);
    fixture.detectChanges();

    const word = query('[data-testid="study-word"]');
    expect(word?.textContent?.trim()).toBe('—');
  });

  it('should show study count', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' }), makeStudy({ id: 's2' })]);
    fixture.detectChanges();

    const count = query('[data-testid="study-count"]');
    expect(count?.textContent).toContain('2 study(ies) found');
  });

  it('should render an Open button for each study row', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' }), makeStudy({ id: 's2' })]);
    fixture.detectChanges();

    const buttons = queryAll('[data-testid="open-study-button"]');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent?.trim()).toBe('Open');
  });

  it('should navigate to study route when Open is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const study = makeStudy({ id: 'open-me' });
    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([study]);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const openBtn = query('[data-testid="open-study-button"]') as HTMLButtonElement;
    openBtn.click();
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledOnce();
    expect(navigateSpy).toHaveBeenCalledWith(['/study', 'open-me']);
  });

  it('should set accessible aria-label on Open button', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    const openBtn = query('[data-testid="open-study-button"]') as HTMLButtonElement;
    expect(openBtn.getAttribute('aria-label')).toBe('Open study for love');
  });

  // --- Delete with confirmation tests ---

  it('should render a Delete button for each study row', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' }), makeStudy({ id: 's2' })]);
    fixture.detectChanges();

    const buttons = queryAll('[data-testid="delete-study-button"]');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent?.trim()).toBe('Delete');
  });

  it('should set accessible aria-label on Delete button', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    const deleteBtn = query('[data-testid="delete-study-button"]') as HTMLButtonElement;
    expect(deleteBtn.getAttribute('aria-label')).toBe('Delete study for love');
  });

  it('should show confirmation modal when Delete is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    expect(query('[data-testid="delete-modal"]')).toBeNull();

    const deleteBtn = query('[data-testid="delete-study-button"]') as HTMLButtonElement;
    deleteBtn.click();
    fixture.detectChanges();

    const modal = query('[data-testid="delete-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('love');
    expect(modal!.textContent).toContain('G25');
  });

  it('should close modal when Cancel is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    // Open modal
    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).not.toBeNull();

    // Cancel
    (query('[data-testid="cancel-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).toBeNull();
  });

  it('should close modal when close (X) button is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    (query('[data-testid="delete-modal-close"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).toBeNull();
  });

  it('should delete study and remove it from the list on confirm', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const studies = [makeStudy({ id: 's1' }), makeStudy({ id: 's2' })];
    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush(studies);
    fixture.detectChanges();

    expect(queryAll('[data-testid="study-row"]').length).toBe(2);

    // Click delete on first study
    (queryAll('[data-testid="delete-study-button"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    // Confirm
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Respond to DELETE request
    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/studies/s1`,
    );
    deleteReq.flush(null);
    fixture.detectChanges();

    // Modal closed, study removed
    expect(query('[data-testid="delete-modal"]')).toBeNull();
    expect(queryAll('[data-testid="study-row"]').length).toBe(1);
    expect(component.studies().length).toBe(1);
    expect(component.studies()[0].id).toBe('s2');
  });

  it('should show error notification when delete fails', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    // Open modal and confirm
    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Fail the DELETE request
    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/studies/s1`,
    );
    deleteReq.flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    // Modal closed, study still in list, error shown
    expect(query('[data-testid="delete-modal"]')).toBeNull();
    expect(queryAll('[data-testid="study-row"]').length).toBe(1);
    const errorNotif = query('[data-testid="delete-error"]');
    expect(errorNotif).not.toBeNull();
    expect(errorNotif!.textContent).toContain('Failed to delete study');
  });

  it('should show loading state on confirm button during delete', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // While request is in flight, button should be loading/disabled
    const confirmBtn = query('[data-testid="confirm-delete-button"]') as HTMLButtonElement;
    expect(confirmBtn.classList.contains('is-loading')).toBe(true);
    expect(confirmBtn.disabled).toBe(true);

    // Complete the request
    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/studies/s1`,
    );
    deleteReq.flush(null);
    fixture.detectChanges();
  });

  it('should use alertdialog role on the confirmation modal', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const modalCard = query('[role="alertdialog"]');
    expect(modalCard).not.toBeNull();
    expect(modalCard!.getAttribute('aria-modal')).toBe('true');
    expect(modalCard!.getAttribute('aria-labelledby')).toBe('delete-modal-title');
    expect(modalCard!.getAttribute('aria-describedby')).toBe('delete-modal-body');
  });

  describe('books column and filter', () => {
    const book = (id: string, name: string) => ({
      id,
      userId: 'u',
      book: name,
      title: '',
      notes: '',
      createdAt: '',
      updatedAt: '',
      referents: [],
    });

    function load(studies: StudyWorksheet[], books: ReturnType<typeof book>[] | 'fail'): void {
      fixture.detectChanges();
      httpTesting = getHttpTesting();
      httpTesting.expectOne(`${environment.apiUrl}/studies`).flush(studies);
      const req = httpTesting.expectOne(`${environment.apiUrl}/books`);
      if (books === 'fail') req.flush('x', { status: 500, statusText: 'err' });
      else req.flush(books);
      fixture.detectChanges();
    }

    const grace = () => makeStudy({ id: 'grace', bookStudyIds: ['b1', 'b2'] });
    const faith = () => makeStudy({ id: 'faith', bookStudyIds: ['b2'] });
    const lone = () => makeStudy({ id: 'lone', bookStudyIds: [] });

    it('shows every linked book name for a study, and a dash when there are none', () => {
      load([grace(), lone()], [book('b1', 'Romans'), book('b2', 'Ephesians')]);
      const cells = queryAll('[data-testid="study-books"]').map((c) => c.textContent?.trim());
      expect(cells).toEqual(['Romans, Ephesians', '—']);
    });

    it('filters to a book and includes studies that are also linked to other books', () => {
      load([grace(), faith(), lone()], [book('b1', 'Romans'), book('b2', 'Ephesians')]);
      component.bookFilter.set('b2');
      fixture.detectChanges();
      expect(queryAll('[data-testid="study-row"]').length).toBe(2);

      component.bookFilter.set('b1');
      fixture.detectChanges();
      expect(queryAll('[data-testid="study-row"]').length).toBe(1);
    });

    it('filters to studies with no book', () => {
      load([grace(), lone()], [book('b1', 'Romans'), book('b2', 'Ephesians')]);
      component.bookFilter.set('none');
      fixture.detectChanges();
      expect(queryAll('[data-testid="study-row"]').length).toBe(1);
      expect(query('[data-testid="study-count"]')?.textContent).toContain('1 study');
    });

    it('hides the filter and shows dashes when the book list fails', () => {
      load([grace()], 'fail');
      expect(query('[data-testid="book-filter"]')).toBeNull();
      expect(query('[data-testid="study-books"]')?.textContent?.trim()).toBe('—');
      expect(queryAll('[data-testid="study-row"]').length).toBe(1);
    });
  });

  describe('sorting, language and grouping (issues #3, #5, #6)', () => {
    const entry = (word: string, strongs: string) => ({
      word,
      strongsNumber: strongs,
      englishDefinition: null,
      strongsDefinition: '',
      originalWord: '',
      transliteration: '',
      lexiconEntry: '',
      crossReferences: [],
      aiSummary: '',
      notes: '',
      definitionNotes: '',
      strongsNotes: '',
      lexiconNotes: '',
    });
    const mk = (id: string, word: string, strongs: string, updatedAt: string) =>
      makeStudy({ id, updatedAt, wordStudies: [entry(word, strongs)] });

    // Arrives newest first, as the API returns it.
    const LIST = () => [
      mk('s1', 'love', 'G25', '2026-05-04T00:00:00.000Z'),
      mk('s2', 'mercy', 'H2617', '2026-05-03T00:00:00.000Z'),
      mk('s3', 'Love', 'G5368', '2026-05-02T00:00:00.000Z'),
      mk('s4', 'faith', 'G4102', '2026-05-01T00:00:00.000Z'),
      mk('s5', 'peace', '', '2026-04-30T00:00:00.000Z'),
    ];

    function load(): void {
      fixture.detectChanges();
      httpTesting = getHttpTesting();
      httpTesting.expectOne(`${environment.apiUrl}/studies`).flush(LIST());
      httpTesting.expectOne(`${environment.apiUrl}/books`).flush([]);
      fixture.detectChanges();
    }

    const words = () => queryAll('[data-testid="study-word"]').map((e) => e.textContent?.trim());
    const click = (id: string) => {
      (query(`[data-testid="${id}"]`) as HTMLElement).click();
      fixture.detectChanges();
    };

    it("shows each study's language from its Strong's number", () => {
      load();
      const langs = queryAll('[data-testid="study-language"]').map((e) => e.textContent?.trim());
      expect(langs).toEqual(['Greek', 'Hebrew', 'Greek', 'Greek', '—']);
    });

    it("filters to Greek, Hebrew, or studies with no Strong's number", () => {
      load();
      const pick = (v: string) => {
        const sel = query('[data-testid="language-filter"]') as HTMLSelectElement;
        sel.value = v;
        sel.dispatchEvent(new Event('change'));
        fixture.detectChanges();
      };
      pick('hebrew');
      expect(words()).toEqual(['mercy']);
      pick('greek');
      expect(words()).toEqual(['love', 'Love', 'faith']);
      pick('none');
      expect(words()).toEqual(['peace']);
      pick('all');
      expect(words().length).toBe(5);
      expect(query('[data-testid="study-count"]')?.textContent).toContain('5 study');
    });

    it('starts newest first and marks that column as sorted', () => {
      load();
      expect(words()).toEqual(['love', 'mercy', 'Love', 'faith', 'peace']);
      const th = query('[data-testid="sort-updated"]')?.closest('th');
      expect(th?.getAttribute('aria-sort')).toBe('descending');
    });

    it('sorts by word when its header is pressed, and reverses on a second press', () => {
      load();
      click('sort-word');
      expect(words()).toEqual(['faith', 'love', 'Love', 'mercy', 'peace']);
      expect(query('[data-testid="sort-word"]')?.closest('th')?.getAttribute('aria-sort')).toBe(
        'ascending',
      );
      expect(query('[data-testid="sort-word"]')?.textContent).toContain('▲');

      click('sort-word');
      expect(words()).toEqual(['peace', 'mercy', 'love', 'Love', 'faith']);
      expect(query('[data-testid="sort-word"]')?.closest('th')?.getAttribute('aria-sort')).toBe(
        'descending',
      );
    });

    it("sorts Strong's numbers by number, not as text", () => {
      load();
      click('sort-strongs');
      const nums = queryAll('[data-testid="study-strongs"]').map((e) => e.textContent?.trim());
      expect(nums).toEqual(['G25', 'G4102', 'G5368', 'H2617', '']);
    });

    it('sorts by language', () => {
      load();
      click('sort-language');
      const langs = queryAll('[data-testid="study-language"]').map((e) => e.textContent?.trim());
      expect(langs).toEqual(['Greek', 'Greek', 'Greek', 'Hebrew', '—']);
    });

    it('only the sorted column has aria-sort set', () => {
      load();
      click('sort-word');
      const sorted = queryAll('th[aria-sort]').filter(
        (t) => t.getAttribute('aria-sort') !== 'none',
      );
      expect(sorted.length).toBe(1);
    });

    it('groups studies of the same English word under a heading, ignoring case', () => {
      load();
      click('group-by-word');
      const rows = queryAll('[data-testid="group-row"], [data-testid="study-row"]').map((r) =>
        r.getAttribute('data-testid') === 'group-row'
          ? `group: ${r.textContent?.replace(/\s+/g, ' ').trim()}`
          : r.querySelector('[data-testid="study-word"]')?.textContent?.trim(),
      );
      expect(rows).toEqual([
        'group: love — 2 studies: G25, G5368',
        'love',
        'Love',
        'mercy',
        'faith',
        'peace',
      ]);
    });

    it('gives no heading to a word with a single study, and ungrouping brings the old order back', () => {
      load();
      click('group-by-word');
      expect(queryAll('[data-testid="group-row"]').length).toBe(1);
      click('group-by-word');
      expect(queryAll('[data-testid="group-row"]').length).toBe(0);
      expect(words()).toEqual(['love', 'mercy', 'Love', 'faith', 'peace']);
    });

    it('grouping follows the chosen sort and the language filter', () => {
      load();
      click('sort-word');
      click('group-by-word');
      const first = query('[data-testid="group-row"], [data-testid="study-row"]');
      expect(first?.getAttribute('data-testid')).toBe('study-row'); // faith comes first and is alone
      expect(first?.textContent).toContain('faith');
    });

    it('still opens and deletes from a grouped list', () => {
      load();
      click('group-by-word');
      const router = TestBed.inject(Router);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      (queryAll('[data-testid="open-study-button"]')[0] as HTMLElement).click();
      expect(nav).toHaveBeenCalledWith(['/study', 's1']);
    });
  });
});
