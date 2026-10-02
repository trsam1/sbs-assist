import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach } from 'vitest';
import { StudyCrudService } from './study-crud.service';
import { StudyWorksheet } from './models';
import { environment } from './environment';

describe('StudyCrudService', () => {
  let service: StudyCrudService;
  let httpTesting: HttpTestingController;

  const mockWorksheet: StudyWorksheet = {
    id: '',
    userId: 'anon-abc123',
    createdAt: '',
    updatedAt: '',
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
        aiSummary: '',
        notes: 'Overall notes',
        definitionNotes: '',
        strongsNotes: '',
        lexiconNotes: '',
      },
    ],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(StudyCrudService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should POST to /studies and return the studyId', () => {
    let result = '';
    service.saveStudy(mockWorksheet).subscribe((id) => (result = id));

    const req = httpTesting.expectOne(`${environment.apiUrl}/studies`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      id: undefined,
      userId: 'anon-abc123',
      createdAt: undefined,
      wordStudies: mockWorksheet.wordStudies,
    });

    req.flush({ studyId: 'new-study-id' });
    expect(result).toBe('new-study-id');
  });

  it('should include id and createdAt when updating an existing study', () => {
    const existing: StudyWorksheet = {
      ...mockWorksheet,
      id: 'existing-id',
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    let result = '';
    service.saveStudy(existing).subscribe((id) => (result = id));

    const req = httpTesting.expectOne(`${environment.apiUrl}/studies`);
    expect(req.request.body.id).toBe('existing-id');
    expect(req.request.body.createdAt).toBe('2025-01-01T00:00:00.000Z');

    req.flush({ studyId: 'existing-id' });
    expect(result).toBe('existing-id');
  });

  it('should GET a study by studyId', () => {
    const savedWorksheet: StudyWorksheet = {
      ...mockWorksheet,
      id: 'study-123',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    };

    let result: StudyWorksheet | undefined;
    service.getStudy('study-123').subscribe((ws) => (result = ws));

    const req = httpTesting.expectOne(`${environment.apiUrl}/studies/study-123`);
    expect(req.request.method).toBe('GET');

    req.flush({
      studyId: 'study-123',
      userId: savedWorksheet.userId,
      createdAt: savedWorksheet.createdAt,
      updatedAt: savedWorksheet.updatedAt,
      wordStudies: savedWorksheet.wordStudies,
    });
    expect(result).toEqual(savedWorksheet);
  });

  it('should normalize a legacy string englishDefinition from getStudy', () => {
    let result: StudyWorksheet | undefined;
    service.getStudy('legacy-1').subscribe((ws) => (result = ws));

    const req = httpTesting.expectOne(`${environment.apiUrl}/studies/legacy-1`);
    req.flush({
      studyId: 'legacy-1',
      userId: mockWorksheet.userId,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      wordStudies: [
        {
          ...mockWorksheet.wordStudies[0],
          englishDefinition: 'an intense feeling of deep affection',
        },
      ],
    });

    expect(result?.wordStudies[0].englishDefinition).toEqual({
      word: 'love',
      meanings: [
        { partOfSpeech: '', definitions: [{ definition: 'an intense feeling of deep affection' }] },
      ],
    });
  });

  it('should propagate HTTP errors from getStudy', () => {
    let error: unknown;
    service.getStudy('bad-id').subscribe({
      error: (e) => (error = e),
    });

    const req = httpTesting.expectOne(`${environment.apiUrl}/studies/bad-id`);
    req.flush('Not found', { status: 404, statusText: 'Not Found' });

    expect(error).toBeTruthy();
  });

  it('should GET /studies and return study list', () => {
    const expected: StudyWorksheet[] = [
      { ...mockWorksheet, id: 's1', updatedAt: '2025-02-01T00:00:00.000Z' },
      { ...mockWorksheet, id: 's2', updatedAt: '2025-01-01T00:00:00.000Z' },
    ];

    let result: StudyWorksheet[] | undefined;
    service.listStudies().subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/studies`);
    expect(req.request.method).toBe('GET');

    req.flush([
      {
        studyId: 's1',
        userId: mockWorksheet.userId,
        createdAt: mockWorksheet.createdAt,
        updatedAt: '2025-02-01T00:00:00.000Z',
        wordStudies: mockWorksheet.wordStudies,
      },
      {
        studyId: 's2',
        userId: mockWorksheet.userId,
        createdAt: mockWorksheet.createdAt,
        updatedAt: '2025-01-01T00:00:00.000Z',
        wordStudies: mockWorksheet.wordStudies,
      },
    ]);
    expect(result).toEqual(expected);
  });

  it('should DELETE /studies/{studyId}', () => {
    let completed = false;
    service.deleteStudy('study-to-delete').subscribe(() => (completed = true));

    const req = httpTesting.expectOne(`${environment.apiUrl}/studies/study-to-delete`);
    expect(req.request.method).toBe('DELETE');

    req.flush({ message: 'Study deleted.' });
    expect(completed).toBe(true);
  });
});
