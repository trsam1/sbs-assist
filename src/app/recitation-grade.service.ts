import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, switchMap, map, timer, concatMap, takeWhile, last, filter } from 'rxjs';
import { RecitationGradeResult } from './models';
import { environment } from './environment';

interface PresignResponse {
  uploadUrl: string;
  s3Key: string;
}

/** grade-start / grade-status responses: either a pending signal or the final graded result. */
interface PendingResponse {
  status: 'pending';
  s3Key: string;
}
type GradeStatusResponse = PendingResponse | ({ status: 'graded' } & RecitationGradeResult);

/** How often to poll grade-status, and the ceiling before we give up. */
const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 45; // ~90s ceiling — batch Transcribe on a short clip finishes well inside this.

/**
 * Client for the Memorize Test-mode recitation auto-grader. The grade work (Amazon Transcribe →
 * Bedrock) is ASYNC so no single request races the API Gateway 29s timeout:
 *   1. presign      — ask the API for a short-lived PUT url + an s3Key under the caller's prefix,
 *   2. PUT          — upload the recorded audio blob directly to S3 (keeps audio off the API),
 *   3. grade-start  — the API kicks off the Transcribe job and returns immediately,
 *   4. grade-status — poll until the job completes; the API then scores it and returns the grade.
 * The audio is transient (the grade Lambda deletes the clip); nothing here is persisted.
 */
@Injectable({ providedIn: 'root' })
export class RecitationGradeService {
  private readonly http = inject(HttpClient);
  private get baseUrl(): string {
    return environment.apiUrl;
  }

  /** Record → upload → start → poll. Resolves to the SM-2 grade + diff + transcript. */
  gradeRecitation(
    clip: Blob,
    chunkText: string,
    reference: string,
  ): Observable<RecitationGradeResult> {
    const contentType = clip.type || 'audio/webm';
    const url = `${this.baseUrl}/ai/recitation-grade`;
    return this.http.post<PresignResponse>(url, { action: 'presign', contentType }).pipe(
      switchMap((presign) =>
        // Direct PUT to the presigned S3 URL (no auth header; the signature authorizes it).
        this.http
          .put(presign.uploadUrl, clip, { headers: { 'Content-Type': contentType } })
          .pipe(map(() => presign.s3Key)),
      ),
      switchMap((s3Key) =>
        // Kick off the async grade job.
        this.http
          .post<GradeStatusResponse>(url, { action: 'grade-start', s3Key, chunkText, reference })
          .pipe(map((started) => ({ s3Key, started }))),
      ),
      switchMap(({ s3Key, started }) => {
        // grade-start may short-circuit to a final result (e.g. the job never started).
        if (started.status === 'graded') return [started as RecitationGradeResult];
        // Otherwise poll grade-status until it is graded (or the ceiling is hit).
        return timer(0, POLL_INTERVAL_MS).pipe(
          takeWhile((n) => n < MAX_POLLS),
          concatMap(() =>
            this.http.post<GradeStatusResponse>(url, {
              action: 'grade-status',
              s3Key,
              chunkText,
              reference,
            }),
          ),
          takeWhile((res) => res.status === 'pending', true),
          filter(
            (res): res is { status: 'graded' } & RecitationGradeResult => res.status === 'graded',
          ),
          last(),
        );
      }),
    );
  }
}
