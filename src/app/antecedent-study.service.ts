import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AntecedentAssignment, AntecedentStudy } from './models';
import { environment } from './environment';

/** Raw record shape returned by the API (DynamoDB field names, incl. PK/SK). */
interface AntecedentStudyRecord {
  scrollStudyId: string;
  userId: string;
  assignments?: AntecedentAssignment[];
  createdAt: string;
  updatedAt: string;
}

function toAntecedentStudy(record: AntecedentStudyRecord): AntecedentStudy {
  return {
    scrollStudyId: record.scrollStudyId,
    userId: record.userId,
    assignments: record.assignments ?? [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for loading and saving antecedent studies via the Antecedent Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class AntecedentStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Fetch the saved antecedent study for a scroll; the API returns 404 if none saved yet. */
  get(scrollStudyId: string): Observable<AntecedentStudy> {
    return this.http
      .get<AntecedentStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/antecedents`)
      .pipe(map(toAntecedentStudy));
  }

  /** Save (create-or-replace) the full set of assignments for a scroll. */
  save(scrollStudyId: string, assignments: AntecedentAssignment[]): Observable<void> {
    return this.http
      .put(`${this.baseUrl}/scroll-studies/${scrollStudyId}/antecedents`, { assignments })
      .pipe(map(() => undefined));
  }
}
