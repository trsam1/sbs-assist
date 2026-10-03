import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { BookStudy, BookStudyInput } from './models';
import { environment } from './environment';

interface CreateBookStudyResponse {
  bookStudyId: string;
}

/** Raw record shape returned by the API (DynamoDB field names). */
interface BookStudyRecord {
  bookStudyId: string;
  userId: string;
  book: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** May be present if the record was already mapped. */
  id?: string;
}

function toBookStudy(record: BookStudyRecord): BookStudy {
  return {
    id: record.id || record.bookStudyId,
    userId: record.userId,
    book: record.book,
    title: record.title ?? '',
    notes: record.notes ?? '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for persisting and retrieving book studies via the Book Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class BookStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** List all book studies for the current user, most recently updated first. */
  list(): Observable<BookStudy[]> {
    return this.http
      .get<BookStudyRecord[]>(`${this.baseUrl}/books`)
      .pipe(map((records) => records.map(toBookStudy)));
  }

  /** Fetch a single book study by id. User scoping is handled by the HTTP interceptor. */
  get(id: string): Observable<BookStudy> {
    return this.http.get<BookStudyRecord>(`${this.baseUrl}/books/${id}`).pipe(map(toBookStudy));
  }

  /** Create a book study. Returns the new bookStudyId. */
  create(input: BookStudyInput): Observable<string> {
    return this.http
      .post<CreateBookStudyResponse>(`${this.baseUrl}/books`, input)
      .pipe(map((res) => res.bookStudyId));
  }

  /** Delete a book study by id. User scoping is handled by the HTTP interceptor. */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/books/${id}`);
  }
}
