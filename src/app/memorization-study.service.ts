import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { MemorizationChunk, MemorizationStudy, MemorizationStudyInput } from './models';
import { environment } from './environment';

/** Raw record shape returned by the API (DynamoDB field names, incl. PK/SK). */
interface MemorizationStudyRecord {
  scrollStudyId: string;
  userId: string;
  chunks?: MemorizationChunk[];
  createdAt: string;
  updatedAt: string;
}

function toMemorizationStudy(record: MemorizationStudyRecord): MemorizationStudy {
  return {
    scrollStudyId: record.scrollStudyId,
    userId: record.userId,
    // Coerce absent chunks / per-chunk fields so a partial record never throws client-side.
    // v2 scheduling fields are optional — a v1 chunk (none present) reads as "due now, ease 2.5"
    // once srs.readSchedule applies its defaults; we only pass through what the server stored.
    chunks: (record.chunks ?? []).map((c) => ({
      start: c.start,
      end: c.end,
      verseRef: c.verseRef ?? '',
      state: c.state ?? 'new',
      ...(c.easeFactor !== undefined ? { easeFactor: c.easeFactor } : {}),
      ...(c.intervalDays !== undefined ? { intervalDays: c.intervalDays } : {}),
      ...(c.repetitions !== undefined ? { repetitions: c.repetitions } : {}),
      ...(c.dueDate !== undefined ? { dueDate: c.dueDate } : {}),
      ...(c.lastReviewed !== undefined ? { lastReviewed: c.lastReviewed } : {}),
    })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for loading and saving memorization studies via the Memorization Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class MemorizationStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Fetch the saved memorization study for a scroll; the API returns 404 if none saved yet. */
  get(scrollStudyId: string): Observable<MemorizationStudy> {
    return this.http
      .get<MemorizationStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/memorize`)
      .pipe(map(toMemorizationStudy));
  }

  /** Save (create-or-replace) the full memorization worksheet for a scroll. */
  save(scrollStudyId: string, input: MemorizationStudyInput): Observable<MemorizationStudy> {
    return this.http
      .put<MemorizationStudyRecord>(
        `${this.baseUrl}/scroll-studies/${scrollStudyId}/memorize`,
        input,
      )
      .pipe(map(toMemorizationStudy));
  }
}
