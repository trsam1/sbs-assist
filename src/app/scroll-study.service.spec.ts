import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScrollStudyService } from './scroll-study.service';
import { environment } from './environment';

describe('ScrollStudyService', () => {
  let service: ScrollStudyService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ScrollStudyService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('createScrollStudy POSTs to /scroll-studies and returns the create response', () => {
    const response = {
      scrollStudyId: 's1',
      uploadUrl: 'https://s3.example/presigned',
      objectKey: 'uploads/u1/s1.pdf',
    };
    let result: typeof response | undefined;
    service
      .createScrollStudy({ bookName: 'Genesis', filename: 'g.pdf', contentType: 'application/pdf' })
      .subscribe((r) => (result = r));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      bookName: 'Genesis',
      filename: 'g.pdf',
      contentType: 'application/pdf',
    });
    req.flush(response);
    expect(result).toEqual(response);
  });

  it('uploadBytes PUTs the file to the presigned URL', () => {
    const url = 'https://my-bucket.s3.amazonaws.com/uploads/u1/s1.pdf?sig=abc';
    const file = new File(['hello'], 'g.pdf', { type: 'application/pdf' });
    let done = false;
    service.uploadBytes(url, file).subscribe(() => (done = true));

    const req = httpTesting.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toBe(file);
    req.flush(null);
    expect(done).toBe(true);
  });

  it('getScrollStudy maps the record to a ScrollStudy', () => {
    let result: { id: string; bookName: string; status: string } | undefined;
    service.getScrollStudy('s1').subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1`);
    expect(req.request.method).toBe('GET');
    req.flush({
      scrollStudyId: 's1',
      userId: 'u1',
      bookName: 'John',
      status: 'ready',
      scrollText: 'In the beginning',
      truncated: false,
      failureReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result?.id).toBe('s1');
    expect(result?.bookName).toBe('John');
    expect(result?.status).toBe('ready');
  });

  it('getScrollStudy fills defaults for missing optional fields', () => {
    let result: { scrollText: string; truncated: boolean; failureReason: string } | undefined;
    service.getScrollStudy('s2').subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s2`);
    req.flush({
      scrollStudyId: 's2',
      userId: 'u1',
      bookName: 'Mark',
      status: 'uploading',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result?.scrollText).toBe('');
    expect(result?.truncated).toBe(false);
    expect(result?.failureReason).toBe('');
  });

  it('listScrollStudies GETs the collection and maps each record', () => {
    let result: { id: string }[] | undefined;
    service.listScrollStudies().subscribe((r) => (result = r));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies`);
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        scrollStudyId: 'a',
        userId: 'u1',
        bookName: 'Acts',
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    ]);
    expect(result?.map((s) => s.id)).toEqual(['a']);
  });

  it('deleteScrollStudy DELETEs the resource', () => {
    let done = false;
    service.deleteScrollStudy('s1').subscribe(() => (done = true));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(done).toBe(true);
  });
});
