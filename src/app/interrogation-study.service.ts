import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { InterrogationEntry, InterrogationStudy, InterrogationStudyInput } from './models';
import { environment } from './environment';

/** Raw record shape returned by the API (DynamoDB field names, incl. PK/SK). */
interface InterrogationStudyRecord {
  scrollStudyId: string;
  userId: string;
  entries?: InterrogationEntry[];
  createdAt: string;
  updatedAt: string;
}

function toInterrogationStudy(record: InterrogationStudyRecord): InterrogationStudy {
  return {
    scrollStudyId: record.scrollStudyId,
    userId: record.userId,
    // Coerce absent entries / per-entry tags to empty lists so a partial record never throws.
    entries: (record.entries ?? []).map((e) => ({ ...e, tags: e.tags ?? [] })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for loading and saving interrogation studies via the Interrogation Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class InterrogationStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Fetch the saved interrogation study for a scroll; the API returns 404 if none saved yet. */
  get(scrollStudyId: string): Observable<InterrogationStudy> {
    return this.http
      .get<InterrogationStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/interrogate`)
      .pipe(map(toInterrogationStudy));
  }

  /** Save (create-or-replace) the full interrogation worksheet for a scroll. */
  save(scrollStudyId: string, input: InterrogationStudyInput): Observable<InterrogationStudy> {
    return this.http
      .put<InterrogationStudyRecord>(
        `${this.baseUrl}/scroll-studies/${scrollStudyId}/interrogate`,
        input,
      )
      .pipe(map(toInterrogationStudy));
  }
}
