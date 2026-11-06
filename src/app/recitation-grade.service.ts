import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, switchMap, map } from 'rxjs';
import { RecitationGradeResult } from './models';
import { environment } from './environment';

interface PresignResponse {
  uploadUrl: string;
  s3Key: string;
}

/**
 * Client for the Memorize Test-mode recitation auto-grader. Three steps, chained:
 *   1. presign — ask the API for a short-lived PUT url + an s3Key under the caller's prefix,
 *   2. PUT the recorded audio blob directly to S3 (bypasses API Gateway — keeps audio off the API),
 *   3. grade — hand the s3Key + the chunk text to the API, which transcribes + scores it.
 * The audio is transient (the grade Lambda deletes the clip); nothing here is persisted.
 */
@Injectable({ providedIn: 'root' })
export class RecitationGradeService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Record → upload → grade in one chained call. Resolves to the SM-2 grade + diff + transcript. */
  gradeRecitation(
    clip: Blob,
    chunkText: string,
    reference: string,
  ): Observable<RecitationGradeResult> {
    const contentType = clip.type || 'audio/webm';
    return this.http
      .post<PresignResponse>(`${this.baseUrl}/ai/recitation-grade`, {
        action: 'presign',
        contentType,
      })
      .pipe(
        switchMap((presign) =>
          // Direct PUT to the presigned S3 URL (no auth header; the signature authorizes it).
          this.http
            .put(presign.uploadUrl, clip, { headers: { 'Content-Type': contentType } })
            .pipe(map(() => presign.s3Key)),
        ),
        switchMap((s3Key) =>
          this.http.post<RecitationGradeResult>(`${this.baseUrl}/ai/recitation-grade`, {
            action: 'grade',
            s3Key,
            chunkText,
            reference,
          }),
        ),
      );
  }
}
