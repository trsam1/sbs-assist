import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { WordStudyEntry } from './models';
import { environment } from './environment';

interface AiSummaryResponse {
  summary: string;
}

/** Service for generating AI study summaries via the backend API. */
@Injectable({ providedIn: 'root' })
export class AiSummaryService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /** Generate an AI summary for a word study entry. Returns the summary string. */
  generateSummary(entry: WordStudyEntry): Observable<string> {
    return this.http
      .post<AiSummaryResponse>(`${this.baseUrl}/ai/study-summary`, entry)
      .pipe(map((res) => res.summary));
  }
}
