import { TestBed, ComponentFixture } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StudyPageComponent } from './study-page.component';
import { StrongsStudyResult, CrossReference, StudyWorksheet } from '../models';
import { environment } from '../environment';

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
        { word: 'love', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }] },
      ]);
      fixture.detectChanges();

      expect(component.word()).toBe('love');
      expect(component.englishDefinition()?.meanings[0]?.definitions[0]?.definition).toBe('deep affection');

      const worksheet = fixture.nativeElement.querySelector(
        'section[aria-label="Word study worksheet"]',
      );
      expect(worksheet).not.toBeNull();
    });

    it('should fetch Strong\'s data when Strong\'s number is submitted', () => {
      component.onWordSubmitted('love');
      httpTesting.expectOne('https://api.dictionaryapi.dev/api/v2/entries/en/love')
        .flush([{ word: 'love', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }] }]);
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
          englishDefinition: { word: 'love', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'deep affection' }] }] },
          strongsDefinition: 'to love',
          originalWord: 'ἀγαπάω',
          transliteration: 'agapaō',
          lexiconEntry: 'From ἀγάπη; to love...',
          crossReferences: [
            { reference: 'Romans 5:8', notes: 'God demonstrates love' },
          ],
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

      const req = httpTesting.expectOne(
        (r) => r.url === `${environment.apiUrl}/studies/study-123`,
      );
      req.flush(savedWorksheet);

      expect(component.loading()).toBe(false);
      expect(component.word()).toBe('love');
      expect(component.studyId()).toBe('study-123');
      expect(component.viewAll()).toBe(true);
      expect(component.notes()).toBe('Overall notes about agape');
      expect(component.aiSummaryState()).toBe('loaded');
      expect(component.englishDefinition()?.meanings[0]?.definitions[0]?.definition).toBe('deep affection');
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
});
