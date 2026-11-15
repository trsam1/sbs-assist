import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  MediaFormat,
} from '@aws-sdk/client-transcribe';
import { randomUUID } from 'node:crypto';
import type { RecitationGradeValue } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const bedrockClient = new BedrockRuntimeClient({});
const s3 = new S3Client({});
const transcribe = new TranscribeClient({});

/** Env read per call so tests can stub freely (same convention as figures-assist). */
function modelId(): string {
  return process.env['RECITATION_GRADE_MODEL_ID'] ?? '';
}
function audioBucket(): string {
  return process.env['RECITATION_AUDIO_BUCKET'] ?? '';
}

/** Short-lived presigned PUT TTL, in seconds (mirrors the scroll-study upload TTL). */
const UPLOAD_URL_TTL_SECONDS = 300;
/** Bound the chunk text sent in a prompt — a single chunk is small; cap defensively. */
const CHUNK_TEXT_CAP = 20_000;

interface APIGatewayEvent {
  httpMethod: string;
  resource: string;
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

interface BedrockResponseBody {
  content?: Array<{ type: string; text?: string }>;
}

/** Extract the Cognito user ID (sub) from the authorizer claims. */
function getUserId(event: APIGatewayEvent): string {
  return event.requestContext?.authorizer?.claims?.['sub'] ?? '';
}

// -------------------------------------------------------------------------
// Pure scoring core (no AWS) — unit-tested in isolation like srs.ts/gestures.ts
// -------------------------------------------------------------------------

/** Normalize text for comparison: lowercase, strip punctuation, collapse whitespace → tokens. */
export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Word-level diff of a recitation transcript against the chunk text, using a longest-common-
 * subsequence alignment. Returns an accuracy percent plus the chunk words that were missed and
 * the transcript words that were added. Forgiving of casing/punctuation (via normalizeTokens).
 */
export function scoreDiff(
  transcript: string,
  chunkText: string,
): { accuracyPct: number; missedWords: string[]; addedWords: string[] } {
  const a = normalizeTokens(chunkText); // reference
  const b = normalizeTokens(transcript); // what was said
  if (a.length === 0) return { accuracyPct: 0, missedWords: [], addedWords: b };

  // LCS length via DP.
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack to find matched indices on each side.
  const matchedA = new Array<boolean>(m).fill(false);
  const matchedB = new Array<boolean>(n).fill(false);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matchedA[i - 1] = true;
      matchedB[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  const matched = dp[m][n];
  const missedWords = a.filter((_, idx) => !matchedA[idx]);
  const addedWords = b.filter((_, idx) => !matchedB[idx]);
  // Accuracy penalizes both drops and spurious additions.
  const accuracyPct = Math.round((matched / Math.max(a.length, b.length)) * 100);
  return { accuracyPct, missedWords, addedWords };
}

/** Map a diff accuracy to an SM-2 grade — the fallback when Bedrock is unavailable. */
export function accuracyToGrade(accuracyPct: number): RecitationGradeValue {
  if (accuracyPct >= 95) return 'easy';
  if (accuracyPct >= 85) return 'good';
  if (accuracyPct >= 60) return 'hard';
  return 'again';
}

/**
 * Build the Bedrock scoring prompt. Carries ONLY the student's own chunk text and their own
 * recitation transcript. Instructs the model to grade recall like a patient study partner,
 * forgiving punctuation/casing/filler and weighting dropped/added/reordered words, and to return
 * a STRICT JSON grade. It must NOT return verse text, an interpretation, or the correct text.
 */
export function buildGradePrompt(transcript: string, chunkText: string, reference: string): string {
  return `You are helping a Bible student memorize Scripture. They just recited a passage FROM MEMORY and you are grading how well they recalled it — the way a patient study partner would, out loud, in a car.

You are given the correct passage text (the student's own study text) and a transcript of what they actually said (speech-to-text, so expect minor mis-hearings). Judge RECALL, forgivingly:
- Ignore punctuation, capitalization, and filler words ("um", "uh", repeated words, self-corrections).
- Minor word-order slips or a dropped article are small; whole dropped or wrong clauses are large.
- A faithful paraphrase that keeps every idea is better than a verbatim attempt that drops a clause.

Map the recall to exactly one grade:
- "again" — could not recall it; large gaps or mostly wrong.
- "hard" — recalled the gist but with real stumbles/omissions.
- "good" — substantially correct with minor slips.
- "easy" — essentially perfect.

Hard rules:
- Respond with ONLY a JSON object (no prose, no code fence), exactly: {"grade":"<again|hard|good|easy>","reason":"<one short clause>"}.
- The "reason" is one short clause about the recall quality — NOT the correct text, NOT an interpretation. Never quote the passage back.

Reference label (for context only): ${reference || 'none'}

Correct passage text:
${chunkText}

What the student recited (transcript):
${transcript || '(nothing was heard)'}`;
}

/** Parse the model's strict-JSON grade output, tolerating a stray code fence or prose. */
export function parseGrade(raw: string): { grade: RecitationGradeValue; reason: string } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const { grade, reason } = obj as Record<string, unknown>;
  if (grade !== 'again' && grade !== 'hard' && grade !== 'good' && grade !== 'easy') return null;
  return { grade, reason: typeof reason === 'string' ? reason : '' };
}

// -------------------------------------------------------------------------
// Handler plumbing (AWS)
// -------------------------------------------------------------------------

async function invokeModel(prompt: string, maxTokens: number): Promise<string> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: modelId(),
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    }),
  );
  const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as BedrockResponseBody;
  return responseBody.content?.[0]?.text?.trim() ?? '';
}

/**
 * Derive a stable Transcribe job name from the clip's S3 key. The job name must be a fresh value
 * per clip (keys carry a UUID, so this is unique) AND recomputable from the key alone, so the
 * async `grade-status` call can find the job WITHOUT the client echoing a job id back. Transcribe
 * job names allow [0-9a-zA-Z._-]; the key's slashes and dots are replaced.
 */
function jobNameForKey(s3Key: string): string {
  return `recite-${s3Key.replace(/[^0-9a-zA-Z._-]/g, '-')}`;
}

/** Kick off a batch transcription job for the uploaded clip. Returns immediately (no polling). */
async function startTranscription(s3Key: string): Promise<string> {
  const jobName = jobNameForKey(s3Key);
  const bucket = audioBucket();
  const mediaFormat = mediaFormatForKey(s3Key);
  console.log(`Transcribe start: job=${jobName} format=${mediaFormat} key=${s3Key}`);
  await transcribe.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: mediaFormat,
      Media: { MediaFileUri: `s3://${bucket}/${s3Key}` },
    }),
  );
  return jobName;
}

/**
 * Check a transcription job ONCE (no sleep-poll). Returns:
 *   { done: false }                 — still running; the client should poll again,
 *   { done: true, transcript }      — completed; transcript text (may be empty),
 *   { done: true, failed: true }    — the job failed (the caller degrades to the diff).
 */
async function checkTranscription(
  s3Key: string,
): Promise<{ done: boolean; transcript?: string; failed?: boolean }> {
  const jobName = jobNameForKey(s3Key);
  let res;
  try {
    res = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
  } catch (err: unknown) {
    // Job not found (e.g. never started, or already reaped) — treat as a failure to degrade.
    console.error('Transcribe status check failed:', err);
    return { done: true, failed: true };
  }
  const status = res.TranscriptionJob?.TranscriptionJobStatus;
  if (status === 'COMPLETED') {
    const uri = res.TranscriptionJob?.Transcript?.TranscriptFileUri;
    if (!uri) return { done: true, transcript: '' };
    try {
      const text = await fetch(uri).then((r) => r.text());
      const parsed = JSON.parse(text) as { results?: { transcripts?: { transcript?: string }[] } };
      return { done: true, transcript: parsed.results?.transcripts?.[0]?.transcript ?? '' };
    } catch (err: unknown) {
      console.error('Transcribe transcript fetch failed:', err);
      return { done: true, failed: true };
    }
  }
  if (status === 'FAILED') {
    console.error('Transcribe job failed:', res.TranscriptionJob?.FailureReason);
    return { done: true, failed: true };
  }
  // QUEUED or IN_PROGRESS — still running.
  return { done: false };
}

const AUDIO_CONTENT_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
]);

/**
 * Map an audio content-type to its Amazon Transcribe `MediaFormat` and a file extension. Transcribe
 * needs the format explicitly OR inferable from the object key's extension — our keys are UUIDs with
 * no extension, so without this the grade step fails with "The media format ... is not valid" and
 * the whole recitation silently returns no grade. The browser often sends a codecs suffix
 * ("audio/webm;codecs=opus"); we match on the base type only.
 */
const MEDIA_FORMATS: Record<string, { format: MediaFormat; ext: string }> = {
  'audio/webm': { format: MediaFormat.WEBM, ext: 'webm' },
  'audio/ogg': { format: MediaFormat.OGG, ext: 'ogg' },
  'audio/mp4': { format: MediaFormat.MP4, ext: 'mp4' },
  'audio/mpeg': { format: MediaFormat.MP3, ext: 'mp3' },
  'audio/wav': { format: MediaFormat.WAV, ext: 'wav' },
  'audio/x-wav': { format: MediaFormat.WAV, ext: 'wav' },
  'audio/flac': { format: MediaFormat.FLAC, ext: 'flac' },
};

/** Base content-type without any codecs suffix, lowercased. */
function baseContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

/** The Transcribe MediaFormat for a stored key, inferred from its extension (default webm). */
function mediaFormatForKey(s3Key: string): MediaFormat {
  const ext = s3Key.split('.').pop()?.toLowerCase() ?? '';
  const match = Object.values(MEDIA_FORMATS).find((m) => m.ext === ext);
  return match?.format ?? MediaFormat.WEBM;
}

/** Best-effort delete of a transient recitation clip (lifecycle reaps it if this fails). */
async function deleteClip(s3Key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: audioBucket(), Key: s3Key }));
  } catch (err: unknown) {
    console.warn('Failed to delete recitation clip (lifecycle will reap it):', err);
  }
}

/** The RecitationGradeResult shape, computed from the deterministic word-diff only (degraded). */
function buildDegradedResult(chunkText: string) {
  const diff = scoreDiff('', chunkText);
  return {
    grade: accuracyToGrade(diff.accuracyPct),
    reason: `Matched ${diff.accuracyPct}% of the words.`,
    accuracyPct: diff.accuracyPct,
    missedWords: diff.missedWords,
    transcript: '',
    degraded: true,
  };
}

/**
 * Score a (possibly empty) transcript against the chunk: always compute the deterministic word-diff
 * baseline, then upgrade to the authoritative Bedrock grade when the transcript is usable and the
 * job did not fail. `failed` short-circuits straight to the diff fallback.
 */
async function scoreTranscript(
  transcript: string,
  chunkText: string,
  reference: string,
  failed = false,
) {
  const diff = scoreDiff(transcript, chunkText);
  let grade: RecitationGradeValue = accuracyToGrade(diff.accuracyPct);
  let reason = `Matched ${diff.accuracyPct}% of the words.`;
  let degraded = failed;

  if (!failed && transcript.trim().length > 0) {
    try {
      const out = await invokeModel(buildGradePrompt(transcript, chunkText, reference), 256);
      const g = parseGrade(out);
      if (g) {
        grade = g.grade;
        reason = g.reason || reason;
      } else {
        degraded = true;
      }
    } catch (err: unknown) {
      console.error('Bedrock grade failed:', err);
      degraded = true;
    }
  } else {
    degraded = true;
  }

  return {
    grade,
    reason,
    accuracyPct: diff.accuracyPct,
    missedWords: diff.missedWords,
    transcript,
    ...(degraded ? { degraded: true } : {}),
  };
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  const userId = getUserId(event);
  if (!userId) {
    return corsResponse(400, { message: 'Missing authentication.' }, origin);
  }
  if (!event.body) {
    return corsResponse(400, { message: 'Request body is required.' }, origin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return corsResponse(400, { message: 'Invalid JSON in request body.' }, origin);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return corsResponse(400, { message: 'Invalid request body.' }, origin);
  }
  const body = parsed as Record<string, unknown>;
  const action = body['action'];

  // --- presign: hand back a short-lived PUT url for the recitation clip ---
  if (action === 'presign') {
    const contentType = typeof body['contentType'] === 'string' ? body['contentType'] : '';
    const base = baseContentType(contentType);
    if (!AUDIO_CONTENT_TYPES.has(base)) {
      return corsResponse(400, { message: 'contentType must be a supported audio type.' }, origin);
    }
    // Give the key a real extension so Amazon Transcribe can infer the media format.
    const ext = MEDIA_FORMATS[base]?.ext ?? 'webm';
    const s3Key = `recitations/${userId}/${randomUUID()}.${ext}`;
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: audioBucket(), Key: s3Key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return corsResponse(200, { uploadUrl, s3Key }, origin);
  }

  // --- grade-start: validate, kick off the Transcribe job, return immediately (no polling) ---
  // The heavy work (Transcribe → Bedrock) is async: the client polls `grade-status` until done,
  // so no single request races the API Gateway 29s timeout.
  if (action === 'grade-start') {
    const s3Key = typeof body['s3Key'] === 'string' ? body['s3Key'] : '';
    const chunkTextRaw = typeof body['chunkText'] === 'string' ? body['chunkText'] : '';
    if (!s3Key.startsWith(`recitations/${userId}/`)) {
      return corsResponse(400, { message: 'Invalid s3Key.' }, origin);
    }
    if (chunkTextRaw.trim().length === 0) {
      return corsResponse(400, { message: 'chunkText is required.' }, origin);
    }
    console.log(`Grade start (async): key=${s3Key} chunkChars=${chunkTextRaw.trim().length}`);
    try {
      await startTranscription(s3Key);
    } catch (err: unknown) {
      // Could not even start the job (e.g. bad media). Grade immediately via the diff fallback and
      // clean up, so the client gets a result rather than polling a job that will never exist.
      console.error('Transcribe start failed:', err);
      await deleteClip(s3Key);
      return corsResponse(
        200,
        { status: 'graded', ...buildDegradedResult(chunkTextRaw.slice(0, CHUNK_TEXT_CAP)) },
        origin,
      );
    }
    return corsResponse(200, { status: 'pending', s3Key }, origin);
  }

  // --- grade-status: check the job ONCE; return pending, or the final graded result ---
  if (action === 'grade-status') {
    const s3Key = typeof body['s3Key'] === 'string' ? body['s3Key'] : '';
    const chunkTextRaw = typeof body['chunkText'] === 'string' ? body['chunkText'] : '';
    const reference = typeof body['reference'] === 'string' ? body['reference'] : '';
    if (!s3Key.startsWith(`recitations/${userId}/`)) {
      return corsResponse(400, { message: 'Invalid s3Key.' }, origin);
    }
    if (chunkTextRaw.trim().length === 0) {
      return corsResponse(400, { message: 'chunkText is required.' }, origin);
    }
    const chunkText = chunkTextRaw.slice(0, CHUNK_TEXT_CAP);

    const check = await checkTranscription(s3Key);
    if (!check.done) {
      return corsResponse(200, { status: 'pending', s3Key }, origin);
    }
    // Terminal: transcribe finished (or failed). Clean up the clip, then score.
    await deleteClip(s3Key);
    const result = await scoreTranscript(
      check.transcript ?? '',
      chunkText,
      reference,
      check.failed,
    );
    return corsResponse(200, { status: 'graded', ...result }, origin);
  }

  // --- grade (legacy synchronous): start + a single status check, then score. Kept for back-compat
  // and callers that want one round-trip; the clip-less fast path still works for valid short jobs. ---
  if (action === 'grade') {
    const s3Key = typeof body['s3Key'] === 'string' ? body['s3Key'] : '';
    const chunkTextRaw = typeof body['chunkText'] === 'string' ? body['chunkText'] : '';
    const reference = typeof body['reference'] === 'string' ? body['reference'] : '';
    if (!s3Key.startsWith(`recitations/${userId}/`)) {
      return corsResponse(400, { message: 'Invalid s3Key.' }, origin);
    }
    if (chunkTextRaw.trim().length === 0) {
      return corsResponse(400, { message: 'chunkText is required.' }, origin);
    }
    const chunkText = chunkTextRaw.slice(0, CHUNK_TEXT_CAP);
    console.log(`Grade start: key=${s3Key} chunkChars=${chunkText.length}`);

    let failed = false;
    let transcript = '';
    try {
      await startTranscription(s3Key);
      const check = await checkTranscription(s3Key);
      if (check.done) {
        transcript = check.transcript ?? '';
        failed = !!check.failed;
      } else {
        // Still running after one check — the synchronous path can't wait; degrade.
        failed = true;
      }
    } catch (err: unknown) {
      console.error('Transcribe failed:', err);
      failed = true;
    } finally {
      await deleteClip(s3Key);
    }
    const result = await scoreTranscript(transcript, chunkText, reference, failed);
    return corsResponse(200, result, origin);
  }

  return corsResponse(
    400,
    { message: 'action must be "presign", "grade-start", "grade-status", or "grade".' },
    origin,
  );
};
