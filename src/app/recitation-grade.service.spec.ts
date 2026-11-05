import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
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

  afterEach(() => httpMock.verify());

  it('chains presign → PUT clip → grade and returns the grade result', () => {
    const clip = new Blob(['audio'], { type: 'audio/webm' });
    let result: unknown;
    service.gradeRecitation(clip, 'the chunk text', '3:16').subscribe((r) => (result = r));

    // 1. presign
    const presign = httpMock.expectOne(`${base}/ai/recitation-grade`);
    expect(presign.request.body).toEqual({ action: 'presign', contentType: 'audio/webm' });
    presign.flush({ uploadUrl: 'https://s3.example/put', s3Key: 'recitations/u/abc' });

    // 2. direct PUT to the presigned url
    const put = httpMock.expectOne('https://s3.example/put');
    expect(put.request.method).toBe('PUT');
    put.flush(null);

    // 3. grade with the s3Key + chunk text
    const grade = httpMock.expectOne(`${base}/ai/recitation-grade`);
    expect(grade.request.body).toEqual({
      action: 'grade',
      s3Key: 'recitations/u/abc',
      chunkText: 'the chunk text',
      reference: '3:16',
    });
    grade.flush({
      grade: 'good',
      reason: 'minor slip',
      accuracyPct: 92,
      missedWords: [],
      transcript: 'the chunk text',
    });

    expect(result).toEqual({
      grade: 'good',
      reason: 'minor slip',
      accuracyPct: 92,
      missedWords: [],
      transcript: 'the chunk text',
    });
  });
});
