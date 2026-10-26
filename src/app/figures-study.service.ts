import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { FigureEntry, FiguresStudy, FiguresStudyInput } from './models';
import { environment } from './environment';

/** Raw record shape returned by the API (DynamoDB field names). */
interface FiguresStudyRecord {
  scrollStudyId: string;
  userId: string;
  entries?: FigureEntry[];
  createdAt: string;
  updatedAt: string;
}

function toFiguresStudy(record: FiguresStudyRecord): FiguresStudy {
  return {
    scrollStudyId: record.scrollStudyId,
    userId: record.userId,
    entries: record.entries ?? [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for loading and saving figures studies (Step 10) via the Figures Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class FiguresStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Fetch the saved figures study for a scroll; the API returns 404 if none saved yet. */
  get(scrollStudyId: string): Observable<FiguresStudy> {
    return this.http
      .get<FiguresStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/figures`)
      .pipe(map(toFiguresStudy));
  }

  /** Save (create-or-replace) the full figures worksheet for a scroll; returns the saved study. */
  save(scrollStudyId: string, input: FiguresStudyInput): Observable<FiguresStudy> {
    return this.http
      .put<FiguresStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/figures`, input)
      .pipe(map(toFiguresStudy));
  }
}
