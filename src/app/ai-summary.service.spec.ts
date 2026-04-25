import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach } from 'vitest';
import { AiSummaryService } from './ai-summary.service';
import { WordStudyEntry } from './models';
import { environment } from './environment';

describe('AiSummaryService', () => {
  let service: AiSummaryService;
  let httpTesting: HttpTestingController;

  const mockEntry: WordStudyEntry = {
    word: 'love',
    strongsNumber: 'G25',
    englishDefinition: 'an intense feeling of deep affection',
    strongsDefinition: 'to love (in a social or moral sense)',
    originalWord: 'ἀγαπάω',
    transliteration: 'agapaō',
    lexiconEntry: 'From ἀγάπη; to love...',
    crossReferences: [
      { reference: 'Romans 5:8', notes: 'God demonstrates love' },
    ],
    aiSummary: '',
    notes: 'Self-sacrificial love',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AiSummaryService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('should POST to /ai/study-summary and return the summary string', () => {
    const expectedSummary = 'The Greek word agapaō represents self-sacrificial love...';

    service.generateSummary(mockEntry).subscribe((result) => {
      expect(result).toBe(expectedSummary);
    });

    const req = httpTesting.expectOne(`${environment.apiUrl}/ai/study-summary`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(mockEntry);
    req.flush({ summary: expectedSummary });
  });

  it('should send the full WordStudyEntry as the request body', () => {
    service.generateSummary(mockEntry).subscribe();

    const req = httpTesting.expectOne(`${environment.apiUrl}/ai/study-summary`);
    expect(req.request.body.word).toBe('love');
    expect(req.request.body.strongsNumber).toBe('G25');
    expect(req.request.body.crossReferences).toHaveLength(1);
    req.flush({ summary: 'test' });
  });
});
