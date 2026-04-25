import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StrongsStudyResult, CrossReference } from './models';
import { environment } from './environment';

/** Service for fetching Strong's concordance data from the backend API. */
@Injectable({ providedIn: 'root' })
export class StrongsLookupService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /** Fetch Strong's definition, original word, transliteration, and lexicon entry. */
  getStrongsStudyData(strongsNumber: string): Observable<StrongsStudyResult> {
    return this.http.get<StrongsStudyResult>(
      `${this.baseUrl}/strongs/${strongsNumber}`,
    );
  }

  /** Fetch all cross-reference verse locations for a Strong's number. */
  getCrossReferences(strongsNumber: string): Observable<CrossReference[]> {
    return this.http.get<CrossReference[]>(
      `${this.baseUrl}/strongs/${strongsNumber}/cross-references`,
    );
  }
}
