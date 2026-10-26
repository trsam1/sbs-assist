import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FigureCandidate } from './models';
import { environment } from './environment';

/** Response from a 'suggest' assist call. `degraded` is true when Bedrock errored (graceful). */
export interface SuggestResponse {
  candidates: FigureCandidate[];
  degraded?: boolean;
  message?: string;
}

/** Response from a 'check' assist call. `degraded` is true when Bedrock errored (graceful). */
export interface CheckResponse {
  advice: string;
  degraded?: boolean;
  message?: string;
}

/**
 * On-demand AI assist for Step 10 (the consultant, never the grader). Both actions POST to
 * `/ai/figures-assist` with an `action` discriminator; each is fired only by an explicit button
 * press and nothing it returns is persisted as the student's work.
 */
@Injectable({ providedIn: 'root' })
export class FiguresAssistService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Surface candidate passages from the student's own scroll text (advisory; creates no entries). */
  suggest(
    scrollText: string,
    notes: string,
    types: readonly string[],
  ): Observable<SuggestResponse> {
    return this.http.post<SuggestResponse>(`${this.baseUrl}/ai/figures-assist`, {
      action: 'suggest',
      scrollText,
      notes,
      types,
    });
  }

  /** Get a second-read opinion on the student's chosen figure type for a passage (never auto-applied). */
  check(figureType: string, reference: string, text: string): Observable<CheckResponse> {
    return this.http.post<CheckResponse>(`${this.baseUrl}/ai/figures-assist`, {
      action: 'check',
      figureType,
      reference,
      text,
    });
  }
}
