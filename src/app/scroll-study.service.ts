import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from './environment';

/** Status progression for a Scroll Study (Step 4 — Observe the Text as a Scroll). */
export type ScrollStatus = 'uploading' | 'extracting' | 'ready' | 'failed';

/** Response from creating a scroll study: the id plus a short-lived presigned S3 PUT. */
export interface CreateScrollStudyResponse {
  scrollStudyId: string;
  uploadUrl: string;
  objectKey: string;
}

/** A persisted scroll study owned by the current user. */
export interface ScrollStudy {
  id: string;
  userId: string;
  bookName: string;
  status: ScrollStatus;
  scrollText: string;
  truncated: boolean;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw record shape returned by the API (DynamoDB field names). */
interface ScrollStudyRecord {
  scrollStudyId: string;
  userId: string;
  bookName: string;
  status: ScrollStatus;
  scrollText?: string;
  truncated?: boolean;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

function toScrollStudy(record: ScrollStudyRecord): ScrollStudy {
  return {
    id: record.scrollStudyId,
    userId: record.userId,
    bookName: record.bookName,
    status: record.status,
    scrollText: record.scrollText ?? '',
    truncated: record.truncated ?? false,
    failureReason: record.failureReason ?? '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for creating, uploading, retrieving, and deleting scroll studies. */
@Injectable({ providedIn: 'root' })
export class ScrollStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Create a scroll study and get a presigned upload target. User scoping via the interceptor. */
  createScrollStudy(input: {
    bookName: string;
    filename: string;
    contentType: string;
  }): Observable<CreateScrollStudyResponse> {
    return this.http.post<CreateScrollStudyResponse>(`${this.baseUrl}/scroll-studies`, input);
  }

  /**
   * Upload the file bytes directly to S3 via the presigned PUT URL. The interceptor does not
   * attach an auth header to the `uploads/` S3 URL (a presigned URL is self-authenticating).
   */
  uploadBytes(uploadUrl: string, file: File): Observable<void> {
    return this.http
      .put(uploadUrl, file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
      .pipe(map(() => undefined));
  }

  /** Fetch a single scroll study by id. */
  getScrollStudy(id: string): Observable<ScrollStudy> {
    return this.http
      .get<ScrollStudyRecord>(`${this.baseUrl}/scroll-studies/${id}`)
      .pipe(map(toScrollStudy));
  }

  /** List the current user's scroll studies, newest first (server-sorted). */
  listScrollStudies(): Observable<ScrollStudy[]> {
    return this.http
      .get<ScrollStudyRecord[]>(`${this.baseUrl}/scroll-studies`)
      .pipe(map((records) => records.map(toScrollStudy)));
  }

  /** Delete a scroll study (record + uploaded object) by id. */
  deleteScrollStudy(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/scroll-studies/${id}`);
  }
}
