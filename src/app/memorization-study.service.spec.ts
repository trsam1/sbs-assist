import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorizationStudyService } from './memorization-study.service';
import { MemorizationStudy } from './models';
import { environment } from './environment';

describe('MemorizationStudyService', () => {
  let service: MemorizationStudyService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MemorizationStudyService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('get GETs /scroll-studies/{id}/memorize and coerces absent chunk fields', () => {
    let result: MemorizationStudy | undefined;
    service.get('s1').subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/memorize`);
    expect(req.request.method).toBe('GET');
    // A partial record: a chunk missing verseRef/state.
    req.flush({
      scrollStudyId: 's1',
      userId: 'u1',
      chunks: [{ start: 0, end: 10 }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result?.chunks[0].verseRef).toBe('');
    expect(result?.chunks[0].state).toBe('new');
  });

  it('get coerces an entirely missing chunks list to []', () => {
    let result: MemorizationStudy | undefined;
    service.get('s1').subscribe((s) => (result = s));
    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/memorize`);
    req.flush({
      scrollStudyId: 's1',
      userId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result?.chunks).toEqual([]);
  });

  it('save PUTs the input to /scroll-studies/{id}/memorize', () => {
    const input = {
      chunks: [{ start: 0, end: 20, verseRef: '2:7', state: 'learning' as const }],
    };
    let result: MemorizationStudy | undefined;
    service.save('s1', input).subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/memorize`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(input);
    req.flush({
      scrollStudyId: 's1',
      userId: 'u1',
      chunks: input.chunks,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result?.chunks.length).toBe(1);
  });
});
