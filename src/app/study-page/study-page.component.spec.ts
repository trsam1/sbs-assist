import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StudyPageComponent } from './study-page.component';
import { StrongsStudyResult, CrossReference } from '../models';
import { environment } from '../environment';
import { BookStudyService } from '../book-study.service';
import { Observable, of, throwError } from 'rxjs';

describe('StudyPageComponent', () => {
  function setup(paramMap: Record<string, string> = {}) {
    const snapshot = {
      paramMap: {
        get: (key: string) => paramMap[key] ?? null,
      },
    };

    TestBed.configureTestingModule({
      imports: [StudyPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot } },
      ],
    });

    const fixture = TestBed.createComponent(StudyPageComponent);
    const component = fixture.componentInstance;
    const httpTesting = TestBed.inject(HttpTestingController);
    return { fixture, component, httpTesting };
  }

  describe('new study flow', () => {
    let fixture: ComponentFixture<StudyPageComponent>;
    let component: StudyPageComponent;
    let httpTesting: HttpTestingController;

    beforeEach(() => {
      ({ fixture, component, httpTesting } = setup());
      fixture.detectChanges();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should show the word input form initially', () => {
      const form = fixture.nativeElement.querySelector('form[aria-label="Word study input"]');
      expect(form).not.toBeNull();
    });

    it('should show worksheet after word is submitted', () => {
      component.onWordSubmitted('love');

      const engDefReq = httpTesting.expectOne(
        'https://api.dictionaryapi.dev/api/v2/entries/en/love',
      );
      engDefReq.flush([
        {
          word: 'love',
          meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }],
        },
      ]);
      fixture.detectChanges();

      expect(component.word()).toBe('love');
      expect(component.englishDefinition()?.meanings[0]?.definitions[0]?.definition).toBe(
        'deep affection',
      );

      const worksheet = fixture.nativeElement.querySelector(
        'section[aria-label="Word study worksheet"]',
      );
      expect(worksheet).not.toBeNull();
    });

    describe('dictionary lookup failures (issue #1)', () => {
      const DICT = 'https://api.dictionaryapi.dev/api/v2/entries/en/love';
      const q = (id: string) =>
        fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

      it('says so and offers a retry when the dictionary cannot be reached, never failing silently', () => {
        component.onWordSubmitted('love');
        httpTesting.expectOne(DICT).flush('x', { status: 503, statusText: 'Unavailable' });
        fixture.detectChanges();

        expect(component.englishDefStatus()).toBe('error');
        expect(q('english-def-error')?.textContent).toContain("Couldn't reach the dictionary");
        expect(q('english-def-retry')).not.toBeNull();
        expect(q('english-definition')).toBeNull();
      });

      it('Try again looks the word up again and shows the definition when it works', () => {
        component.onWordSubmitted('love');
        httpTesting.expectOne(DICT).error(new ProgressEvent('error'));
        fixture.detectChanges();

        q('english-def-retry')?.click();
        httpTesting.expectOne(DICT).flush([
          {
            word: 'love',
            meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }],
          },
        ]);
        fixture.detectChanges();

        expect(component.englishDefStatus()).toBe('found');
        expect(q('english-def-error')).toBeNull();
        expect(q('english-definition')?.textContent).toContain('deep affection');
      });

      it('shows the loading state while retrying', () => {
        component.onWordSubmitted('love');
        httpTesting.expectOne(DICT).error(new ProgressEvent('error'));
        fixture.detectChanges();
        q('english-def-retry')?.click();
        fixture.detectChanges();
        expect(component.englishDefLoading()).toBe(true);
        expect(q('english-def-error')).toBeNull();
        httpTesting.expectOne(DICT).error(new ProgressEvent('error'));
      });

      it('says the word has no entry on a 404, without a retry that cannot help', () => {
        component.onWordSubmitted('love');
        httpTesting.expectOne(DICT).flush('x', { status: 404, statusText: 'Not Found' });
        fixture.detectChanges();

        expect(component.englishDefStatus()).toBe('not-found');
        expect(q('english-def-not-found')?.textContent).toContain('no entry for "love"');
        expect(q('english-def-retry')).toBeNull();
        expect(q('english-def-error')).toBeNull();
      });

      it('offers "Look it up" for a saved study that has no definition, and fills it in', () => {
        component.word.set('love'); // as when an older study was saved after a failed lookup
        fixture.detectChanges();
        expect(q('english-def-unavailable')?.textContent).toContain('Definition not available.');

        q('english-def-retry')?.click();
        httpTesting.expectOne(DICT).flush([
          {
            word: 'love',
            meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }],
          },
        ]);
        fixture.detectChanges();
        expect(q('english-definition')?.textContent).toContain('deep affection');
        expect(q('english-def-unavailable')).toBeNull();
      });

      it("keeps the student working: notes and the Strong's step are still there after a failure", () => {
        component.onWordSubmitted('love');
        httpTesting.expectOne(DICT).flush('x', { status: 500, statusText: 'Server Error' });
        fixture.detectChanges();
        expect(q('step1-notes')).not.toBeNull();
      });
    });

    it("should fetch Strong's data when Strong's number is submitted", () => {
      component.onWordSubmitted('love');
      httpTesting.expectOne('https://api.dictionaryapi.dev/api/v2/entries/en/love').flush([
        {
          word: 'love',
          meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }],
        },
      ]);
      fixture.detectChanges();

      const mockStrongs: StrongsStudyResult = {
        strongsNumber: 'G25',
        definition: 'to love',
        originalWord: 'ἀγαπάω',
        transliteration: 'agapaō',
        lexiconEntry: 'From ἀγάπη; to love...',
      };
      const mockRefs: CrossReference[] = [{ reference: 'Romans 5:8', notes: '' }];

      component.onStrongsNumberSubmitted({ strongsNumber: 'G25' });

      const strongsReq = httpTesting.expectOne(`${environment.apiUrl}/strongs/G25`);
      const refsReq = httpTesting.expectOne(`${environment.apiUrl}/strongs/G25/cross-references`);
      strongsReq.flush(mockStrongs);
      refsReq.flush(mockRefs);
      fixture.detectChanges();

      expect(component.strongsData()).toEqual(mockStrongs);
      expect(component.crossReferences()).toEqual(mockRefs);
    });
  });

  describe('edit study flow (with route param)', () => {
    afterEach(() => {
      localStorage.clear();
    });

    const savedWorksheet = {
      studyId: 'study-123',
      userId: 'anonymous',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
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
          crossReferences: [{ reference: 'Romans 5:8', notes: 'God demonstrates love' }],
          aiSummary: 'The Greek word agapaō represents self-sacrificial love...',
          notes: 'Overall notes about agape',
          definitionNotes: '',
          strongsNotes: '',
          lexiconNotes: '',
        },
      ],
    };

    it('should load study from route param on init', () => {
      const { fixture, component, httpTesting } = setup({ studyId: 'study-123' });
      fixture.detectChanges();

      expect(component.loading()).toBe(true);

      const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies/study-123`);
      req.flush(savedWorksheet);

      expect(component.loading()).toBe(false);
      expect(component.word()).toBe('love');
      expect(component.studyId()).toBe('study-123');
      expect(component.viewAll()).toBe(true);
      expect(component.notes()).toBe('Overall notes about agape');
      expect(component.aiSummaryState()).toBe('loaded');
      expect(component.englishDefinition()?.meanings[0]?.definitions[0]?.definition).toBe(
        'deep affection',
      );
    });

    it('should load a legacy study whose englishDefinition is a plain string', () => {
      const legacy = {
        ...savedWorksheet,
        wordStudies: [
          {
            ...savedWorksheet.wordStudies[0],
            englishDefinition: 'an intense feeling of deep affection',
          },
        ],
      };
      const { fixture, component, httpTesting } = setup({ studyId: 'study-123' });
      fixture.detectChanges();

      const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies/study-123`);
      req.flush(legacy);
      fixture.detectChanges();

      expect(component.error()).toBeFalsy();
      const el: HTMLElement | null = fixture.nativeElement.querySelector(
        '[data-testid="english-definition"]',
      );
      expect(el).toBeTruthy();
      expect(el?.textContent).toContain('an intense feeling of deep affection');
      expect(el?.textContent).not.toContain('()');
      expect(fixture.nativeElement.textContent).not.toContain('()');
    });

    it('should show error when study load fails', () => {
      const { fixture, component, httpTesting } = setup({ studyId: 'bad-id' });
      fixture.detectChanges();

      const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies/bad-id`);
      req.flush('Not found', { status: 404, statusText: 'Not Found' });

      expect(component.loading()).toBe(false);
      expect(component.error()).toContain('Failed to load saved study');
    });

    it('should show error when study has no word study entries', () => {
      const emptyWorksheet = { ...savedWorksheet, wordStudies: [] };
      const { fixture, component, httpTesting } = setup({ studyId: 'study-123' });
      fixture.detectChanges();

      const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies/study-123`);
      req.flush(emptyWorksheet);

      expect(component.loading()).toBe(false);
      expect(component.error()).toContain('no word study entries');
    });
  });

  describe('book links', () => {
    const books = [
      {
        id: 'b1',
        userId: 'u',
        book: 'Romans',
        title: '',
        notes: '',
        createdAt: '',
        updatedAt: '',
        referents: [],
      },
      {
        id: 'b2',
        userId: 'u',
        book: 'Ephesians',
        title: '',
        notes: '',
        createdAt: '',
        updatedAt: '',
        referents: [],
      },
    ];
    const entry = {
      word: 'grace',
      strongsNumber: '',
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
    };

    function setupLinks(opts: {
      params?: Record<string, string>;
      query?: Record<string, string>;
      list: () => Observable<typeof books>;
    }) {
      TestBed.configureTestingModule({
        imports: [StudyPageComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                paramMap: { get: (k: string) => opts.params?.[k] ?? null },
                queryParamMap: { get: (k: string) => opts.query?.[k] ?? null },
              },
            },
          },
          { provide: BookStudyService, useValue: { list: opts.list } },
        ],
      });
      const fixture = TestBed.createComponent(StudyPageComponent);
      const httpTesting = TestBed.inject(HttpTestingController);
      return { fixture, component: fixture.componentInstance, httpTesting };
    }

    it('starts linked to the book it was opened from', () => {
      const { fixture, component } = setupLinks({
        query: { bookStudyId: 'b2' },
        list: () => of(books),
      });
      fixture.detectChanges();
      expect(component.bookStudyIds()).toEqual(['b2']);
    });

    it('shows the books control once a word is entered, with the opened-from book checked', () => {
      const { fixture, component } = setupLinks({
        query: { bookStudyId: 'b2' },
        list: () => of(books),
      });
      fixture.detectChanges();
      component.word.set('grace');
      fixture.detectChanges();
      const box = (id: string) =>
        fixture.nativeElement.querySelector(`[data-testid="book-link-${id}"]`) as HTMLInputElement;
      expect(box('b2').checked).toBe(true);
      expect(box('b1').checked).toBe(false);
    });

    it('loads the saved links, and saves several books at once', () => {
      const { fixture, component, httpTesting } = setupLinks({
        params: { studyId: 's1' },
        list: () => of(books),
      });
      fixture.detectChanges();
      httpTesting.expectOne(`${environment.apiUrl}/studies/s1`).flush({
        studyId: 's1',
        userId: 'u',
        createdAt: 'c',
        updatedAt: '',
        wordStudies: [entry],
        bookStudyIds: ['b1'],
      });
      expect(component.bookStudyIds()).toEqual(['b1']);

      component.bookStudyIds.set(['b1', 'b2']);
      component.onSaveStudy();
      const save = httpTesting.expectOne(`${environment.apiUrl}/studies`);
      expect(save.request.body.bookStudyIds).toEqual(['b1', 'b2']);
      save.flush({ studyId: 's1' });
    });

    it('hides the control but still saves the existing links when the book list fails', () => {
      const { fixture, component, httpTesting } = setupLinks({
        params: { studyId: 's1' },
        list: () => throwError(() => ({ status: 500 })),
      });
      fixture.detectChanges();
      httpTesting.expectOne(`${environment.apiUrl}/studies/s1`).flush({
        studyId: 's1',
        userId: 'u',
        createdAt: 'c',
        updatedAt: '',
        wordStudies: [entry],
        bookStudyIds: ['b1', 'b2'],
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="book-links"]')).toBeNull();

      component.onSaveStudy();
      const save = httpTesting.expectOne(`${environment.apiUrl}/studies`);
      expect(save.request.body.bookStudyIds).toEqual(['b1', 'b2']);
      save.flush({ studyId: 's1' });
    });

    it('keeps an id for a deleted book until the selection changes, then drops it', () => {
      const { fixture, component, httpTesting } = setupLinks({
        params: { studyId: 's1' },
        list: () => of(books),
      });
      fixture.detectChanges();
      httpTesting.expectOne(`${environment.apiUrl}/studies/s1`).flush({
        studyId: 's1',
        userId: 'u',
        createdAt: 'c',
        updatedAt: '',
        wordStudies: [entry],
        bookStudyIds: ['b1', 'deleted'],
      });
      fixture.detectChanges();
      expect(component.bookStudyIds()).toEqual(['b1', 'deleted']);

      (
        fixture.nativeElement.querySelector('[data-testid="book-link-b2"]') as HTMLInputElement
      ).click();
      fixture.detectChanges();
      expect(component.bookStudyIds()).toEqual(['b1', 'b2']);
    });
  });
});
