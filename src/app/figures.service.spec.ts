import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach } from 'vitest';
import { FiguresStudyService } from './figures-study.service';
import { FiguresAssistService } from './figures-assist.service';
import { environment } from './environment';

describe('FiguresStudyService', () => {
  let service: FiguresStudyService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FiguresStudyService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('GETs /scroll-studies/:id/figures', () => {
    service.get('s1').subscribe();
    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/figures`);
    expect(req.request.method).toBe('GET');
    req.flush({ scrollStudyId: 's1', userId: 'u1', entries: [], createdAt: '', updatedAt: '' });
  });

  it('PUTs the worksheet to /scroll-studies/:id/figures', () => {
    const input = { entries: [] };
    service.save('s1', input).subscribe();
    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/figures`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(input);
    req.flush({ scrollStudyId: 's1', userId: 'u1', entries: [], createdAt: '', updatedAt: '' });
  });

  it('defaults a missing entries array to []', () => {
    service.get('s1').subscribe((study) => expect(study.entries).toEqual([]));
    httpTesting
      .expectOne(`${environment.apiUrl}/scroll-studies/s1/figures`)
      .flush({ scrollStudyId: 's1', userId: 'u1', createdAt: '', updatedAt: '' });
  });
});

describe('FiguresAssistService', () => {
  let service: FiguresAssistService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FiguresAssistService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('POSTs a suggest action to /ai/figures-assist', () => {
    service.suggest('scroll text', 'note', ['metaphor']).subscribe();
    const req = httpTesting.expectOne(`${environment.apiUrl}/ai/figures-assist`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      action: 'suggest',
      scrollText: 'scroll text',
      notes: 'note',
      types: ['metaphor'],
    });
    req.flush({ candidates: [] });
  });

  it('POSTs a check action to /ai/figures-assist', () => {
    service.check('metaphor', '5:2', 'thief').subscribe();
    const req = httpTesting.expectOne(`${environment.apiUrl}/ai/figures-assist`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      action: 'check',
      figureType: 'metaphor',
      reference: '5:2',
      text: 'thief',
    });
    req.flush({ advice: 'ok' });
  });
});
