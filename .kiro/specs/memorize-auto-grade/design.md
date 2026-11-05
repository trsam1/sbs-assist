# Design Document: Memorize the Scroll — spoken-recitation auto-grading (Test mode)

## Overview

This feature adds **Test mode** to the Memorize the Scroll tool: a student recites a due verse aloud from
memory and the system **grades the recall automatically**, feeding the result into the already-shipped
SM-2 scheduler. It is the retrieval half of "memorize with a partner" — the friend who says *your turn*,
listens, and tells you how you did — and it is built for the user's primary case: **hands-free in the
car**.

It is deliberately a **real backend service**, not a frontend bolt-on. The browser records a short clip
of the recitation; a new **`RecitationGrade` Lambda** runs **Amazon Transcribe** (batch) to get a
transcript, then asks **Amazon Bedrock** (the Haiku tier already wired for Step 5's AI summary) to grade
the recall the way a patient study partner would — forgiving punctuation, casing, filler, and minor
stumbles — returning an SM-2 grade, a one-line reason, and the missed words. Browser-only
`webkitSpeechRecognition` was rejected (Chrome/WebKit-only, mic-gated, single-shot, poor in car noise, and
unable to make the "close enough" judgment Scripture recall needs); the server path transcribes far better
under noise and the Bedrock step is what makes the grade trustworthy.

The feature is **additive and stateful-safe**. New resources: a `RecitationGrade` Lambda, its log group,
an API route pair (presigned upload + grade), a **transient audio S3 location** with a short-TTL lifecycle
rule, and IAM for Transcribe + Bedrock + S3. No DynamoDB table, no change to any stateful resource; the
stateful guard stays a no-op; counts move additively. The recitation audio is **transient** — deleted as
soon as grading completes, with the lifecycle rule as a backstop — and only the resulting SM-2 schedule
update persists, through the existing path.

Four design points were decided with the user before this draft:

- **D1 — server-side Transcribe + Bedrock scoring**, not browser recognition. A deterministic word-diff is
  computed alongside as a transparency aid and a fallback grade when Bedrock is down.
- **D2 — batch Transcribe**, not streaming (a few seconds between verses is fine; far less code).
- **D3 — auto-commit in a hands-free "drive" sub-mode; suggest-and-confirm at a desk.** Default **desk**:
  nothing auto-commits until the student opts into drive.
- **D4 — audio is transient**, deleted post-grade; the transcript lives only in memory for the scoring
  call. Nothing recitation-related is persisted.

## Architecture

The shipped Review-mode deck (due queue, flip card, `grade()` → `applyGrade` → `save()`) is reused whole.
Test mode adds a **record → upload → grade → apply** path alongside it. The only new server component is
the `RecitationGrade` Lambda; the memorize CRUD Lambda, the MemorizationStudies table, and the scheduler
are untouched.

```mermaid
graph TD
    subgraph Frontend ["Frontend (Angular 21 + Bulma)"]
        TV[memorize-view — Test mode NEW<br/>record · propose/commit · drive/desk]
        REC[MediaRecorder clip]
        RGS[RecitationGradeService NEW<br/>presign → PUT → grade]
    end

    subgraph AWS ["AWS Cloud"]
        APIGW[API Gateway + Cognito authorizer]
        RG[RecitationGrade Lambda NEW<br/>presign · transcribe · score · cleanup]
        S3A[(S3 transient audio prefix NEW<br/>short-TTL lifecycle)]
        TRANS[Amazon Transcribe<br/>batch job]
        BR[Amazon Bedrock<br/>Haiku grading model NEW grant]
        SCHED[existing SM-2 path<br/>grade → save → MemorizationStudies]
    end

    TV --> REC --> RGS
    RGS -->|1. presign PUT| APIGW --> RG -->|presigned url| RGS
    RGS -->|2. PUT clip| S3A
    RGS -->|3. grade {s3key, chunkText, ref}| APIGW --> RG
    RG -->|StartTranscriptionJob + poll| TRANS
    TRANS -->|transcript| RG
    RG -->|score transcript vs chunk| BR
    BR -->|grade + reason| RG
    RG -->|DeleteObject| S3A
    RG -->|{grade, reason, accuracyPct, missedWords, transcript, degraded?}| RGS
    RGS -->|apply via existing grade| SCHED
```

The frontend applies the returned grade through the **existing** `grade()` path — the scheduler, the table,
and the persistence are unchanged. Test mode is a new rendering/flow over the same deck and the same save.

## Decisions

**Server-side Transcribe + Bedrock, with a deterministic diff alongside (D1).** The Lambda runs a batch
Transcribe job on the clip, then builds a scoring prompt carrying the transcript and the chunk text and
invokes Bedrock (same `InvokeModelCommand` shape as `ai-summary`/`figures-assist`). The model returns a
strict JSON `{ grade, reason }` (parsed tolerantly, like `parseCandidates`). Independently, the Lambda
computes a normalized word-level diff (lowercase, strip punctuation, collapse whitespace → token
alignment) producing an `accuracyPct` and `missedWords[]`. The Bedrock grade is authoritative; the diff is
shown to the student as *why* and is the **fallback grade** (mapped from `accuracyPct` to an SM-2 grade) if
Bedrock errors. This is exactly what makes the result better than a client diff: the model understands
"substantially correct, two stumbles" = Good, while the diff keeps the feature honest and resilient.

**Batch Transcribe (D2).** `StartTranscriptionJob` on the uploaded clip, then poll `GetTranscriptionJob`
to completion (bounded, with a timeout → degraded). Simpler than the streaming SDK and the inter-verse
latency is acceptable. Streaming is a documented later refinement.

**Drive vs desk; default desk (D3).** A `testGradeMode` toggle. Desk: the Lambda's grade + reason +
accuracy are rendered as a **proposal** and the student confirms (commit + advance) or overrides with the
existing Again/Hard/Good/Easy buttons. Drive: the grade **commits automatically** via the existing
`grade()`, an `aria-live` region announces it, and the deck auto-advances — no screen touch. Default is
desk so nothing is ever written on the student's behalf until they opt into drive.

**Transient audio, deleted post-grade (D4).** The clip goes to a dedicated S3 prefix (e.g.
`recitations/<sub>/<uuid>.webm`) via a presigned PUT. The Lambda deletes the object as soon as grading
finishes (success or failure); a bucket **lifecycle rule** expires anything under the prefix after a short
TTL (1 day) as a backstop. No audio or transcript is ever written to a study record; the transcript is
returned to the student's own session only.

**Grading model is a per-stage `stage-config.ts` value (A2).** A new `recitationGradeModelId` joins
`StageConfig`, mirroring `figuresAssistModelId`: prod and dev each name a model id (default the Haiku tier
Step 5 uses — the scoring prompt is small and cheap), and the CDK wires it into both the Lambda's
`RECITATION_GRADE_MODEL_ID` env and its `bedrock:InvokeModel` resource ARNs so model and grant never drift.
A behavior setting, editable with an explicit change — not a frozen physical name.

**Additive, stateful-safe infra (A6).** Every new resource is an addition with a new construct ID
(`RecitationGradeFn`, its `fnLogs('RecitationGradeFn')` log group, `RecitationAudioBucket` or a prefix +
lifecycle on an existing non-stateful bucket, the API resources). The MemorizationStudies table, the user
pool, and WordStudies keep their IDs and physical names. The stateful guard is a no-op; counts move +1
function / +1 log group (+1 bucket if a new bucket is chosen); the `diff` shows additive `[+]` lines plus
the API-deployment hash rotation from the new route.

## Components and Interfaces

### `RecitationGrade` Lambda (new) — `infra/lambda/recitation-grade/index.ts`

An API-Gateway-invoked handler with two actions (mirroring the figures-assist `action` dispatch), plus a
pure, unit-tested core:

```typescript
/** Normalize text for comparison: lowercase, strip punctuation, collapse whitespace → tokens. (pure) */
export function normalizeTokens(text: string): string[];

/** Word-level diff of a recitation transcript against the chunk text. (pure) */
export function scoreDiff(transcript: string, chunkText: string): {
  accuracyPct: number;      // 0..100
  missedWords: string[];    // in chunk, absent/wrong in transcript
  addedWords: string[];     // in transcript, not in chunk
};

/** Map a diff accuracy to an SM-2 grade — the fallback when Bedrock is unavailable. (pure) */
export function accuracyToGrade(accuracyPct: number): 'again' | 'hard' | 'good' | 'easy';

/** Build the Bedrock scoring prompt (transcript + chunk text; forgiving-partner rubric). (pure) */
export function buildGradePrompt(transcript: string, chunkText: string, reference: string): string;

/** Parse the model's strict-JSON grade output, tolerating a stray fence/prose. (pure) */
export function parseGrade(raw: string): { grade: 'again'|'hard'|'good'|'easy'; reason: string } | null;
```

Actions:

- **`action: 'presign'`** — body `{ contentType }`; returns `{ uploadUrl, s3Key }` (a presigned PUT to the
  transient prefix keyed by the caller's `sub` + a uuid). Bounds content type to audio.
- **`action: 'grade'`** — body `{ s3Key, chunkText, reference }`; the handler:
  1. Validates `s3Key` belongs to the caller's `sub` prefix (reject cross-user keys → `400`).
  2. `StartTranscriptionJob` on the S3 object → poll `GetTranscriptionJob` (bounded, timeout → degraded).
  3. `scoreDiff` + `accuracyToGrade` (deterministic baseline).
  4. `InvokeModel` with `buildGradePrompt` → `parseGrade` (authoritative grade when present).
  5. `DeleteObject` on the clip (always, in a `finally`).
  6. Return `{ grade, reason, accuracyPct, missedWords, transcript, degraded? }` — Bedrock grade when
     parsed, else the diff fallback with `degraded: true`.

`chunkText` is bounded (same cap posture as figures-assist's `SCROLL_TEXT_CAP`, scaled to a single chunk).
The handler fetches **no** Bible text and returns none; it holds only the student's own scroll chunk passed
in and the student's own transcript.

### Frontend (`memorize-view` + a new service, additive)

- **`RecitationGradeService`** (new) — `presign()`, `putClip(uploadUrl, blob)`, `grade({ s3Key, chunkText,
  reference })`, returning the typed grade result; stubbed in component tests.
- **`memorize-view` Test mode** — a new top-level mode alongside Review/Edit (the mode toggle gains a
  **Test** button). It reuses the shipped deck (`dueQueue`, `deck`/`deckPos`, `currentCardIndex`,
  `advanceDeck`, `gradeCard`'s SM-2 call). New surface:
  - a **record** control using `MediaRecorder` (feature-detected; absent/denied → fall back to the manual
    grade buttons with a message, per A5/R1.3),
  - a **drive/desk** toggle (`data-testid` `test-grade-mode`), default desk,
  - after grading: desk → a **grade proposal** (grade + reason + `accuracyPct` + missed words) with
    confirm/override buttons; drive → auto-commit + `aria-live` announce + auto-advance,
  - `degraded` → show the chunk text and the manual grade buttons; session continues.

Audio announcement of the grade is explicitly **deferred to the audio-coaching feature**; this spec
announces via the visual card + `aria-live` only.

### Infrastructure (`word-study-tool-stack.ts` + `stage-config.ts`)

- **`StageConfig` gains:** `recitationGradeModelId: string` (per-stage, mirroring `figuresAssistModelId`;
  default the Haiku tier). Lives only here.
- **Stack gains:**
  - the `recitation-grade` NodejsFunction (mirroring `commonLambdaProps`, its own
    `fnLogs('RecitationGradeFn')` log group),
  - a **transient audio location**: a new `RecitationAudioBucket` (`autoDeleteObjects` in dev; a short-TTL
    `LifecycleRule` expiring `recitations/` after 1 day in both stages) **or** a dedicated prefix +
    lifecycle on an existing non-stateful bucket — the design review picks one; a dedicated bucket is the
    lower-coupling default,
  - the API resource(s) (`/recitation-grade` with the `presign`/`grade` actions, Cognito-authorized like
    the other study routes),
  - IAM on the Lambda: `transcribe:StartTranscriptionJob` + `GetTranscriptionJob`, `bedrock:InvokeModel`
    scoped to the `recitationGradeModelId` ARNs (region + base + inference-profile, matching the
    figures-assist grant), and S3 `PutObject`/`GetObject`/`DeleteObject` scoped to the transient prefix.

All new construct IDs are new; nothing existing is renamed.

## Data Model

**No new persisted data.** Test mode writes nothing beyond the existing SM-2 schedule fields on the graded
chunk, through the existing `save()` path. The recitation clip is transient S3 (deleted post-grade); the
transcript is in-memory only. No new DynamoDB item, no new attribute on any record.

## API

| Method | Path | Request body | Success | Errors |
|---|---|---|---|---|
| POST | `/recitation-grade` | `{ action: 'presign', contentType }` | `200 { uploadUrl, s3Key }` | `400` bad/missing contentType or auth |
| POST | `/recitation-grade` | `{ action: 'grade', s3Key, chunkText, reference }` | `200 { grade, reason, accuracyPct, missedWords, transcript, degraded? }` | `400` bad field / cross-user s3Key / missing auth |

The clip upload itself is a direct **PUT to the presigned S3 URL** (not through API Gateway), keeping the
audio payload off the API. Existing memorize/study routes are unchanged.

## Validation

- `action` — required, `'presign'` or `'grade'` (else `400`), matching the figures-assist dispatch.
- `presign`: `contentType` required and must be an audio MIME type (else `400`).
- `grade`: `s3Key` required and MUST start with the caller's `recitations/<sub>/` prefix (reject cross-user
  keys → `400`); `chunkText` required non-empty string, bounded to the cap; `reference` optional string.
- The handler never accepts or returns fetched Bible text; the only text in play is the caller's own chunk
  and their own transcript.

## Error Handling

| Operation | Failure | Behaviour |
|---|---|---|
| mic / MediaRecorder | unavailable / permission denied | frontend falls back to manual grade buttons with a message; no server call |
| presign | bad contentType / auth | `400`; nothing created |
| upload (PUT) | network / S3 error | frontend surfaces a retry; no grade attempted |
| Transcribe | job error / timeout | Lambda returns `degraded: true` with the diff-fallback grade (if the clip transcribed partially) or asks the student to self-grade; clip still deleted |
| Bedrock | throttle / parse failure | Lambda returns the **diff-fallback** grade with `degraded: true` and the accuracy/missed-words; frontend shows the chunk + manual buttons as an override |
| cleanup | DeleteObject error | logged; the lifecycle rule expires the clip as a backstop |

A `degraded` response is never a dead end — the student always has the chunk text and the manual grade
buttons, exactly the Review-mode fallback, mirroring the Step 10 figures-assist `degraded` pattern.

## Testing Strategy

All under the existing harness (Angular + vitest frontend; vitest + `setup-no-aws` for Lambdas). Nothing
calls AWS, Transcribe, Bedrock, or S3.

### Unit tests — `RecitationGrade` core (pure)
- `normalizeTokens` — lowercases, strips punctuation, collapses whitespace; handles empty.
- `scoreDiff` — identical text → 100% / no missed; dropped/added/reordered words reflected in
  `accuracyPct`/`missedWords`/`addedWords`; forgiving of casing/punctuation.
- `accuracyToGrade` — boundary mapping (e.g. ≥95 → easy, ≥85 → good, ≥60 → hard, else again), monotonic.
- `buildGradePrompt` — carries transcript + chunk + reference, forbids returning meaning/verse text,
  requests strict-JSON grade; never embeds fetched Bible text.
- `parseGrade` — parses clean JSON, tolerates a code fence/prose, returns `null` on an out-of-set grade.

### Lambda handler tests (mocked Transcribe / Bedrock / S3)
- `presign` returns a presigned URL + an `s3Key` under the caller's `sub` prefix; rejects a non-audio
  contentType.
- `grade` happy path: mocked Transcribe transcript + mocked Bedrock grade → returns the Bedrock grade +
  reason + the diff accuracy/missed words; asserts `DeleteObject` was called.
- `grade` cross-user `s3Key` → `400`, no Transcribe call.
- Bedrock failure → `degraded: true` with the diff-fallback grade; clip still deleted (assert the `finally`
  cleanup ran).
- Transcribe timeout → `degraded` path; no throw out of the handler.
- No test performs a real AWS call (the `setup-no-aws` harness + per-client mocks).

### Component tests — `memorize-view` Test mode (TestBed, stubbed `RecitationGradeService`)
- Test mode renders the record control when MediaRecorder is available; falls back to manual buttons when
  it is not.
- Desk mode: a stubbed grade result renders a **proposal**; confirming calls the existing `grade()` once
  with the proposed grade and advances; overriding calls it with the chosen grade.
- Drive mode: a stubbed grade result auto-commits (one `grade()` call) and auto-advances with an `aria-live`
  announcement; no confirm step.
- `degraded` result shows the chunk + manual buttons; the deck still advances on a manual grade.
- Existing Review/Edit/scheduler/reminder tests stay green (Test mode is additive).

### CDK assertion tests — `word-study-tool-stack.test.ts` (UPDATED to the new counts)
- Counts move additively: `AWS::Lambda::Function` +1, `AWS::Logs::LogGroup` +1 (and the audio bucket +
  lifecycle if a new bucket). Assert the `RecitationGradeFn`, its log group, the `/recitation-grade` route,
  the transient-audio lifecycle rule, and the Lambda's Transcribe/Bedrock/S3 IAM exist. The stateful-guard
  expectations (no table/user-pool/bucket-of-record replace/delete) stay green.

## Risks

- **Cost — Transcribe is the driver.** ~$0.006–0.008 per ~15–20s recitation; a heavy day (30 recitations)
  ≈ $0.20/day, a few dollars/month under active drive-time use, vs ≈ $0.20/month today. Opt-in → idle $0.
  Documented in `delivery.md`; an optional per-session cap is available if the maintainer wants a ceiling.
  This is the real tradeoff of a trustworthy grader vs a free-but-dumb client diff — accepted with the user.
- **Latency.** Batch Transcribe + a Bedrock call is a few seconds per verse. Acceptable between verses;
  streaming is the upgrade path if it ever grates. The UI shows a clear "grading…" state and never blocks
  the manual buttons.
- **Transcription accuracy in the car.** Road noise and one-shot audio can mis-transcribe; the forgiving
  Bedrock rubric and the diff tolerance absorb minor errors, and the student can always override in desk
  mode. Drive mode trades that override for hands-free convenience — the student opts into it knowingly.
- **Drive-mode auto-commit writing a wrong grade.** Mitigated: default is desk; drive is an explicit opt-in;
  an Again re-queues within the session; and SM-2 self-corrects over subsequent reviews (one bad grade
  nudges the interval, it does not corrupt the learned state, which this path never touches).
- **Audio privacy.** The clip is transient (deleted post-grade; 1-day lifecycle backstop) and never written
  to a study record; the transcript is in-memory only and returned to the student's own session. Documented.
- **First `bedrock:InvokeModel` grant outside Step 5/10.** Mirrors the figures-assist grant exactly (scoped
  to the per-stage model ARNs); no new IAM pattern, just a new scoped grant.

## Out of scope

- **Browser `SpeechRecognition` grading** — rejected (D1).
- **Streaming transcription** — batch only (D2).
- **The audio-coaching Learn/Test SpeechSynthesis loops** — separate V3 spec
  (`.kiro/specs/memorize-audio-coaching/`); this spec reuses the shipped Review deck and does not require it.
- **Persisting recitations / transcripts / per-recitation analytics** — audio transient; only the SM-2
  schedule update persists.
- **Non-English transcription tuning**, custom vocabularies, speaker diarization.
- **Any change** to the SM-2 scheduler, the learned-`state` ladder, the v1/v2 data shape, or any shipped
  Step 4–12 tool/route beyond the additive Test-mode surface and the `/recitation-grade` route.

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
