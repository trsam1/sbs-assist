import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach } from 'vitest';
import { BookStudyService } from './book-study.service';
import { BookStudy } from './models';
import { environment } from './environment';

describe('BookStudyService', () => {
  let service: BookStudyService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BookStudyService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should POST to /books and return the bookStudyId', () => {
    let result = '';
    service.create({ book: 'Genesis', title: 'My study', notes: 'notes' }).subscribe((id) => {
      result = id;
    });

    const req = httpTesting.expectOne(`${environment.apiUrl}/books`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ book: 'Genesis', title: 'My study', notes: 'notes' });

    req.flush({ bookStudyId: 'new-book-id' });
    expect(result).toBe('new-book-id');
  });

  it('should GET /books and map records to the BookStudy model', () => {
    const expected: BookStudy[] = [
      {
        id: 'b1',
        userId: 'u1',
        book: 'John',
        title: 'John study',
        notes: '',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-02-01T00:00:00.000Z',
      },
    ];

    let result: BookStudy[] | undefined;
    service.list().subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/books`);
    expect(req.request.method).toBe('GET');

    req.flush([
      {
        bookStudyId: 'b1',
        userId: 'u1',
        book: 'John',
        title: 'John study',
        notes: '',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-02-01T00:00:00.000Z',
      },
    ]);
    expect(result).toEqual(expected);
  });

  it('should GET a single book study and map bookStudyId to id', () => {
    let result: BookStudy | undefined;
    service.get('b1').subscribe((bs) => (result = bs));

    const req = httpTesting.expectOne(`${environment.apiUrl}/books/b1`);
    expect(req.request.method).toBe('GET');

    req.flush({
      bookStudyId: 'b1',
      userId: 'u1',
      book: 'Genesis',
      title: '',
      notes: 'some notes',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    expect(result?.id).toBe('b1');
    expect(result?.book).toBe('Genesis');
    expect(result?.notes).toBe('some notes');
  });

  it('should propagate HTTP errors from get', () => {
    let error: unknown;
    service.get('bad-id').subscribe({ error: (e) => (error = e) });

    const req = httpTesting.expectOne(`${environment.apiUrl}/books/bad-id`);
    req.flush('Not found', { status: 404, statusText: 'Not Found' });

    expect(error).toBeTruthy();
  });

  it('should DELETE /books/{id}', () => {
    let completed = false;
    service.delete('b-del').subscribe(() => (completed = true));

    const req = httpTesting.expectOne(`${environment.apiUrl}/books/b-del`);
    expect(req.request.method).toBe('DELETE');

    req.flush({ message: 'Book study deleted.' });
    expect(completed).toBe(true);
  });
});
