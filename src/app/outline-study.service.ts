import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { OutlineNode, OutlineStudy, OutlineStudyInput } from './models';
import { environment } from './environment';

/** Raw record shape returned by the API (DynamoDB field names, incl. PK/SK). */
interface OutlineStudyRecord {
  scrollStudyId: string;
  userId: string;
  nodes?: OutlineNode[];
  createdAt: string;
  updatedAt: string;
}

function toOutlineStudy(record: OutlineStudyRecord): OutlineStudy {
  return {
    scrollStudyId: record.scrollStudyId,
    userId: record.userId,
    nodes: record.nodes ?? [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for loading and saving outline studies via the Outline Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class OutlineStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Fetch the saved outline study for a scroll; the API returns 404 if none saved yet. */
  get(scrollStudyId: string): Observable<OutlineStudy> {
    return this.http
      .get<OutlineStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/outline`)
      .pipe(map(toOutlineStudy));
  }

  /** Save (create-or-replace) the full outline worksheet for a scroll; returns the saved study. */
  save(scrollStudyId: string, input: OutlineStudyInput): Observable<OutlineStudy> {
    return this.http
      .put<OutlineStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/outline`, input)
      .pipe(map(toOutlineStudy));
  }
}
