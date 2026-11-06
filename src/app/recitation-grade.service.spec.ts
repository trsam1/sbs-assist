import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecitationGradeService } from './recitation-grade.service';
import { environment } from './environment';

describe('RecitationGradeService', () => {
  let service: RecitationGradeService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [RecitationGradeService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RecitationGradeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  const gradedBody = {
    status: 'graded',
    grade: 'good',
    reason: 'minor slip',
    accuracyPct: 92,
    missedWords: [],
    transcript: 'the chunk text',
  };

  it('chains presign → PUT → grade-start → poll grade-status until graded', () => {
    vi.useFakeTimers();
    const clip = new Blob(['audio'], { type: 'audio/webm' });
    let result: unknown;
    service.gradeRecitation(clip, 'the chunk text', '3:16').subscribe((r) => (result = r));

    httpMock
      .expectOne(`${base}/ai/recitation-grade`)
      .flush({ uploadUrl: 'https://s3.example/put', s3Key: 'recitations/u/abc.webm' });
    httpMock.expectOne('https://s3.example/put').flush(null);
    const start = httpMock.expectOne(`${base}/ai/recitation-grade`);
    expect(start.request.body).toEqual({
      action: 'grade-start',
      s3Key: 'recitations/u/abc.webm',
      chunkText: 'the chunk text',
      reference: '3:16',
    });
    start.flush({ status: 'pending', s3Key: 'recitations/u/abc.webm' });

    // first poll (tick 0) — still pending
    vi.advanceTimersByTime(0);
    const poll1 = httpMock.expectOne(`${base}/ai/recitation-grade`);
    expect(poll1.request.body).toEqual({
      action: 'grade-status',
      s3Key: 'recitations/u/abc.webm',
      chunkText: 'the chunk text',
      reference: '3:16',
    });
    poll1.flush({ status: 'pending', s3Key: 'recitations/u/abc.webm' });
    expect(result).toBeUndefined();

    // next poll (after the interval) — graded
    vi.advanceTimersByTime(2000);
    httpMock.expectOne(`${base}/ai/recitation-grade`).flush(gradedBody);
    expect((result as { grade: string }).grade).toBe('good');
  });

  it('resolves immediately when grade-start short-circuits to a graded result', () => {
    const clip = new Blob(['audio'], { type: 'audio/webm' });
    let result: unknown;
    service.gradeRecitation(clip, 'the chunk text', '3:16').subscribe((r) => (result = r));

    httpMock
      .expectOne(`${base}/ai/recitation-grade`)
      .flush({ uploadUrl: 'https://s3.example/put', s3Key: 'recitations/u/abc.webm' });
    httpMock.expectOne('https://s3.example/put').flush(null);

    // grade-start returns a terminal (degraded) result rather than a pending signal.
    httpMock.expectOne(`${base}/ai/recitation-grade`).flush({
      status: 'graded',
      grade: 'again',
      reason: 'Matched 0% of the words.',
      accuracyPct: 0,
      missedWords: ['the', 'chunk', 'text'],
      transcript: '',
      degraded: true,
    });

    // No grade-status poll should fire.
    expect((result as { degraded?: boolean }).degraded).toBe(true);
  });
});
