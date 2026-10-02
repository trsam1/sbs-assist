import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { StudyWorksheet, WordStudyEntry } from './models';
import { environment } from './environment';
import { normalizeEnglishDefinition } from './english-definition.normalize';

interface SaveStudyResponse {
  studyId: string;
}

/** Raw record shape returned by the API (DynamoDB field names). */
interface StudyRecord {
  studyId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  /** `englishDefinition` may be a legacy plain string (items saved before 2026-04-27). */
  wordStudies: (Omit<WordStudyEntry, 'englishDefinition'> & { englishDefinition?: unknown })[];
  /** May be present if the record was already mapped. */
  id?: string;
}

function toWorksheet(record: StudyRecord): StudyWorksheet {
  return {
    id: record.id || record.studyId,
    userId: record.userId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    wordStudies: (record.wordStudies ?? []).map((e) => ({
      ...e,
      englishDefinition: normalizeEnglishDefinition(e.englishDefinition, e.word),
    })),
  };
}

/** Service for persisting and retrieving word study worksheets via the Study CRUD API. */
@Injectable({ providedIn: 'root' })
export class StudyCrudService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /** Fetch a single saved study by studyId. User scoping is handled by the HTTP interceptor. */
  getStudy(studyId: string): Observable<StudyWorksheet> {
    return this.http.get<StudyRecord>(
      `${this.baseUrl}/studies/${studyId}`,
    ).pipe(map(toWorksheet));
  }

  /** List all saved studies for the current user, sorted by most recently updated. */
  listStudies(): Observable<StudyWorksheet[]> {
    return this.http.get<StudyRecord[]>(
      `${this.baseUrl}/studies`,
    ).pipe(map((records) => records.map(toWorksheet)));
  }

  /** Delete a saved study by studyId. User scoping is handled by the HTTP interceptor. */
  deleteStudy(studyId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/studies/${studyId}`,
    );
  }

  /** Save (create or update) a word study worksheet. Returns the studyId. */
  saveStudy(worksheet: StudyWorksheet): Observable<string> {
    return this.http
      .post<SaveStudyResponse>(`${this.baseUrl}/studies`, {
        id: worksheet.id || undefined,
        userId: worksheet.userId,
        createdAt: worksheet.createdAt || undefined,
        wordStudies: worksheet.wordStudies,
      })
      .pipe(map((res) => res.studyId));
  }
}
