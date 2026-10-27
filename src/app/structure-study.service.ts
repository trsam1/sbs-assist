import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  StructureElement,
  StructureMarker,
  StructureSection,
  SecondaryGenre,
  StructureStudy,
  StructureStudyInput,
} from './models';
import { environment } from './environment';

/** Raw record shape returned by the API (DynamoDB field names, incl. PK/SK). */
interface StructureStudyRecord {
  scrollStudyId: string;
  userId: string;
  genre?: string;
  tone?: string;
  markers?: StructureMarker[];
  sections?: StructureSection[];
  elements?: StructureElement[];
  secondaryGenres?: SecondaryGenre[];
  createdAt: string;
  updatedAt: string;
}

function toStructureStudy(record: StructureStudyRecord): StructureStudy {
  return {
    scrollStudyId: record.scrollStudyId,
    userId: record.userId,
    genre: record.genre ?? '',
    tone: record.tone ?? '',
    markers: record.markers ?? [],
    sections: record.sections ?? [],
    elements: record.elements ?? [],
    // Legacy records saved before this feature have no field; coerce to an empty list.
    secondaryGenres: record.secondaryGenres ?? [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Service for loading and saving structure studies via the Structure Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class StructureStudyService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Fetch the saved structure study for a scroll; the API returns 404 if none saved yet. */
  get(scrollStudyId: string): Observable<StructureStudy> {
    return this.http
      .get<StructureStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/structure`)
      .pipe(map(toStructureStudy));
  }

  /** Save (create-or-replace) the full structure worksheet for a scroll; returns the saved study. */
  save(scrollStudyId: string, input: StructureStudyInput): Observable<StructureStudy> {
    return this.http
      .put<StructureStudyRecord>(`${this.baseUrl}/scroll-studies/${scrollStudyId}/structure`, input)
      .pipe(map(toStructureStudy));
  }
}
