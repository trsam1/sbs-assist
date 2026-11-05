# Requirements: Memorize the Scroll — spoken-recitation auto-grading (Test mode)

## Context and assumptions

The Memorize the Scroll tool now has a visual flashcard **Review mode** (`.kiro/specs/memorize-review-mode/`,
shipped) over the shipped SM-2 scheduler. The user wants a genuinely **hands-free, in-the-car** study
experience modeled on memorizing with a partner: a **Test mode** where the student recites a verse aloud
from memory and is **graded automatically** — the system listens, compares what was said to the chunk
text, maps the result to an SM-2 grade (Again / Hard / Good / Easy), and advances. The grade feeds the
**existing SM-2 scheduler** so a drive-time session actually advances the student's schedule.

This is deliberately a **real backend feature**, not a frontend bolt-on. Browser-only speech recognition
(`webkitSpeechRecognition`) was explicitly **rejected** for the grader: it is Chrome/WebKit-only,
mic-gated, single-shot, and poor in car noise, and it cannot make the "close enough" judgment Scripture
recall needs (it marks contractions, `and`/`&`, and minor word-order as wrong). The decision is a
server-side transcription + scoring service that does the job well.

A separate V3 feature — **audio coaching (Learn + Test loops with `SpeechSynthesis`)** — is specced on its
own track (`.kiro/specs/memorize-audio-coaching/`, to follow). This spec is **only** the auto-grading
retrieval-scoring layer. It is designed to slot into Test mode whether the coaching audio ships before or
after it: the recitation-grade service and its record/upload/score UI stand on their own and reuse the
shipped Review-mode deck.

### Confirmed decisions (settled with the user before this draft)

- **D1 — server-side transcription + Bedrock scoring, NOT browser recognition.** The browser records the
  recitation as a short audio clip; a new **`RecitationGrade` Lambda** runs **Amazon Transcribe**
  (batch) to get the transcript, then hands the transcript + the chunk text to **Amazon Bedrock** (the
  Haiku tier already wired for Step 5's AI summary) to grade recall the way a patient study partner would
  and return a grade + a one-line reason + the missed words. A pure word-diff percentage was considered
  and **rejected as the default** (it cannot judge "substantially correct with two stumbles" = Good); the
  diff is still computed and returned alongside the Bedrock grade as a transparency aid and a deterministic
  fallback if Bedrock is unavailable.
- **D2 — batch Transcribe, not streaming.** The clip is uploaded, transcribed as a batch job, then scored.
  Between-verse latency (a few seconds) is acceptable and the code is far simpler than a streaming
  pipeline. Streaming is out of scope (a later refinement).
- **D3 — auto-commit in a hands-free "drive" sub-mode; suggest-and-confirm at a desk.** In drive mode the
  computed grade **commits automatically** (the UI speaks/shows "Good — next" and advances) so the student
  never touches the screen mid-drive. In desk mode the grade is **proposed** and the student confirms or
  overrides with the existing grade buttons before it commits. One toggle; default **desk** (safe —
  nothing auto-commits until the student opts into drive mode).
- **D4 — audio is transient and never persisted beyond grading.** The recitation clip is uploaded to a
  dedicated S3 prefix with a **short TTL lifecycle rule** (e.g. 1 day) and is deleted as soon as grading
  completes; the transcript is held only in memory for the scoring call. No audio and no transcript are
  stored in DynamoDB or kept after the grade is returned. Only the resulting SM-2 schedule update persists,
  through the existing path.

### Assumptions (flagged for the design review; each the lowest-risk reading of the request)

- **A1 — the grade feeds the EXISTING SM-2 path unchanged.** `RecitationGrade` returns one of
  `again|hard|good|easy`; the frontend applies it through the already-shipped `grade()` → `applyGrade` →
  `save()` chain (schedule fields only, never the learned-`state` ladder). No scheduler change.
- **A2 — the grading model is a per-stage `stage-config.ts` value**, exactly like `figuresAssistModelId`:
  a behavior setting (not a frozen physical name), prod and dev each naming a model id, the CDK wiring it
  into both the Lambda's env and its Bedrock IAM ARNs so model and grant never drift. Default: the same
  Haiku tier Step 5 uses (cheap; the scoring prompt is small).
- **A3 — verse text never leaves the student's device except as THEIR OWN spoken recitation.** The chunk
  text sent to Bedrock for scoring is the student's own scroll text (already in their browser / stored per
  their upload), and the audio is the student's own voice reciting from memory. The service fetches no
  copyrighted Bible text and returns none; the "offsets/locations only" invariant for app-served content
  holds (this feature serves no verse text — it scores the student's own words against the student's own
  scroll).
- **A4 — Test mode runs the DUE queue**, like Review mode: it pulls due chunks soonest-first, presents the
  reference, records the recitation, grades, and advances — so a drive-time test session clears the day's
  due stack.
- **A5 — graceful degradation at every external step.** No mic / permission denied → Test mode falls back
  to the manual grade buttons (Review-mode behavior), never a broken screen. Transcribe or Bedrock error →
  the student is shown the chunk and asked to self-grade with the buttons; the session continues. A
  `degraded` flag mirrors the Step 10 figures-assist pattern.
- **A6 — new infra is additive and stateful-safe.** The new resources (one `RecitationGrade` Lambda, one
  log group, one API route, one S3 prefix/lifecycle on a new or reused transient bucket, IAM for
  Transcribe + Bedrock + S3) are **added**, never replacing or removing an existing resource. The
  MemorizationStudies table, the user pool, and WordStudies are untouched in shape; the stateful guard
  stays clean.
- **A7 — cost is documented and bounded.** Transcribe (~$0.024/min) is the cost driver; a ~15–20s
  recitation is ~$0.006–0.008 per graded clip. The feature is opt-in (a student must enter Test mode), so
  idle cost is $0. The cost line is documented in `delivery.md` with the prod delta.

---

## Requirement 1: Record a spoken recitation in Test mode

### User Story
As a Bible student, I want to recite a verse aloud and have it captured, so the tool can grade my recall
without my typing anything.

### Acceptance Criteria
1. Test mode SHALL present the current **due** chunk's reference label (no verse text on screen until after
   grading) and a clear **record** control (large, keyboard-operable, ARIA-labelled).
2. The system SHALL capture the recitation with the browser **MediaRecorder** API into a short audio clip
   (no new dependency), with a visible recording indicator and a stop control (and a max-duration safety
   cap, e.g. 60s, after which recording auto-stops).
3. When the browser exposes **no** microphone / recording capability, or the user denies permission, Test
   mode SHALL fall back to the manual grade buttons (the Review-mode flow) with an explanatory message —
   never a broken or dead control.
4. The recitation audio SHALL be treated as transient: uploaded only for grading, never displayed back,
   never written to any study record.

## Requirement 2: Grade the recitation server-side (Transcribe → Bedrock)

### User Story
As a Bible student, I want the tool to listen to my recitation and judge how well I recalled the verse —
forgiving minor stumbles the way a study partner would — so the grade is trustworthy and hands-free.

### Acceptance Criteria
1. The system SHALL upload the clip to a **transient S3 location** (presigned PUT) and invoke a new
   **`RecitationGrade` Lambda** with the object reference and the target chunk's text + reference.
2. The Lambda SHALL run **Amazon Transcribe (batch)** on the clip to produce a transcript, then invoke
   **Amazon Bedrock** (the per-stage grading model) with a prompt carrying the transcript and the chunk
   text, instructing it to grade recall as a patient partner — ignoring punctuation, casing, and filler;
   weighting dropped/added/reordered words — and to return a grade in `{again, hard, good, easy}` with a
   one-line reason.
3. The Lambda SHALL also compute a deterministic **word-level diff** (alignment / normalized distance)
   between transcript and chunk text, returning an accuracy percentage and the list of missed/added words,
   as a transparency aid shown to the student and as a **fallback grade** when Bedrock is unavailable.
4. The Lambda SHALL return `{ grade, reason, accuracyPct, missedWords[], transcript, degraded? }`; it SHALL
   **never** return verse text it fetched (it holds only the student's own scroll text passed in) and SHALL
   bound the chunk text it accepts (same cap posture as the figures assist).
5. The recitation clip SHALL be **deleted from S3** as soon as grading completes (success or failure); a
   lifecycle rule SHALL expire any clip not cleaned up within a short TTL (e.g. 1 day) as a backstop.
6. Any failure (upload, Transcribe, Bedrock) SHALL degrade gracefully: the Lambda returns `degraded: true`
   with the diff-based fallback grade when it can, and the frontend shows the chunk and the manual grade
   buttons so the student self-grades and continues — the session never dead-ends.

## Requirement 3: Apply the grade and advance (drive vs desk)

### User Story
As a Bible student testing in the car, I want the grade applied and the next verse queued automatically, so
I never touch the screen; and at my desk I want to confirm or override the grade first.

### Acceptance Criteria
1. The computed grade SHALL be applied through the **existing SM-2 path** (`grade()` → `applyGrade` →
   `save()`), updating only the scheduling fields, never the learned-`state` ladder.
2. A **mode toggle** SHALL select **desk** (default) vs **drive**:
   - **desk:** the computed grade + reason + accuracy are **proposed**; the student confirms (commit +
     advance) or overrides with the Again/Hard/Good/Easy buttons before anything is saved.
   - **drive:** the computed grade **commits automatically**, the UI announces it (visually and via an
     `aria-live` region; audio announcement belongs to the coaching-audio feature), then **auto-advances**
     to the next due chunk — no screen interaction required.
3. An **Again** grade (auto or confirmed) SHALL re-queue the chunk within the session deck (matching
   Review-mode behavior), so a missed verse recurs.
4. Test mode SHALL run the **due queue** soonest-due first with the shipped deck progress indicator, and
   SHALL present an all-caught-up end state when the deck is cleared.
5. The default SHALL be **desk / nothing auto-commits** until the student explicitly selects drive mode, so
   a grade is never silently written on the student's behalf by default.

## Requirement 4: Additive, stateful-safe infrastructure

### User Story
As the maintainer, I want the auto-grading infrastructure to add resources without touching any stateful
resource, so the stateful guard stays clean and nothing existing is replaced.

### Acceptance Criteria
1. The feature SHALL add exactly: **one** `RecitationGrade` Lambda, **one** CDK-named log group for it, the
   **API route(s)** for presigned-upload + grade, a **transient audio S3 location** (a new bucket or a
   dedicated prefix on an existing non-stateful assets bucket) with a **short-TTL lifecycle rule**, and the
   IAM needed (`transcribe:StartTranscriptionJob`/`GetTranscriptionJob` or the streaming equivalent,
   `bedrock:InvokeModel` scoped to the grading model ARNs, and S3 `PutObject`/`GetObject`/`DeleteObject`
   scoped to the transient prefix). No new DynamoDB table; no change to any stateful resource.
2. Every existing resource SHALL be **unchanged in shape** — no rename, replace, or delete. The stateful
   guard SHALL report `✅ No stateful-resource replacement or deletion`.
3. Resource counts SHALL move **additively** (AWS::Lambda::Function +1, AWS::Logs::LogGroup +1, and the new
   bucket/lifecycle if a new bucket is chosen). The CDK assertion test SHALL be updated to the new counts
   and SHALL assert the `RecitationGrade` function, its log group, and its Transcribe/Bedrock/S3 IAM exist.
4. The grading model id and any grading-specific per-stage values SHALL live **only** in `stage-config.ts`
   (mirroring `figuresAssistModelId`); no model id, bucket name, or stage value hardcoded elsewhere.
5. Per `delivery.md`, the cost impact SHALL be documented: Transcribe as the driver (~$0.006–0.008 per
   graded recitation), Bedrock Haiku scoring as fractions of a cent, S3/Lambda/API negligible; idle cost
   $0 (opt-in). The prod delta SHALL be noted.

---

## Non-Functional Requirements

1. **Stack conformance.** Infra change (new `RecitationGrade` Lambda + log group + API route + transient S3
   lifecycle + IAM) plus an additive frontend Test-mode surface. All new per-stage values in
   `stage-config.ts`. No new table; no change to any existing construct ID or physical name.
2. **Additive & stateful-safe.** No stateful resource replaced/removed; guard clean. Counts move additively;
   the `diff` job shows only additions (plus the memorize Lambda/API-deployment hash rotation from the
   added route), no replace/delete on `WordStudyToolStack`.
3. **Copyright policy.** The service serves **no** verse text. It scores the student's own spoken recitation
   against the student's own scroll text; it fetches no copyrighted Bible text and returns none. The chunk
   text is shown back to the student only after their recitation (their own scroll, same as Review mode).
4. **Cost.** Opt-in → idle $0. Active cost is dominated by Transcribe (~$0.006–0.008 / recitation); Bedrock
   Haiku scoring is a few hundredths of a cent; S3/Lambda/API negligible. Documented in `delivery.md` with a
   worked example (e.g. 30 recitations/day ≈ $0.20/day) and the prod delta. A cost ceiling (opt-in gating,
   and an optional per-session cap) SHALL be noted as available if the maintainer wants one.
5. **Privacy & data handling.** The recitation audio is transient (deleted post-grade; short-TTL lifecycle
   backstop) and never persisted to a study record. The transcript is held only in memory for the scoring
   call and is returned to the student's own session, not stored.
6. **Graceful degradation.** Every external dependency (mic, Transcribe, Bedrock) degrades to the manual
   grade buttons with a clear message. Test mode is never a dead end; a `degraded` response mirrors the
   Step 10 figures-assist pattern.
7. **Accessibility.** The record control, the grade proposal, and the drive/desk toggle SHALL be keyboard
   operable and screen-reader labelled, with an `aria-live` announcement of the proposed/committed grade,
   matching the Review-mode deck's ARIA patterns.
8. **No test calls AWS, Transcribe, Bedrock, or S3.** The Lambda's prompt-building, diff/scoring, and
   grade-mapping are unit-tested with mocked Transcribe/Bedrock/S3 clients under the existing no-AWS
   harness; the frontend Test-mode flow is tested under the existing TestBed harness with a stubbed grade
   service; the CDK assertions prove the new resources synth.

---

## Out of Scope

- **Browser-only `SpeechRecognition` grading** — explicitly rejected (D1) in favor of server-side
  Transcribe + Bedrock.
- **Streaming transcription** — batch only (D2); streaming is a later refinement if latency matters.
- **The audio-coaching Learn/Test SpeechSynthesis loops** — a separate V3 spec
  (`.kiro/specs/memorize-audio-coaching/`). This spec is only the auto-grading scoring layer; it reuses the
  shipped Review-mode deck and does not depend on the coaching audio shipping first.
- **Persisting recitations, transcripts, or per-recitation history / analytics** — audio is transient; only
  the SM-2 schedule update persists, through the existing path.
- **Multi-language / non-English transcription tuning** — the scroll text is the student's own; language
  configuration beyond a sensible default is out of scope.
- **Any change to the SM-2 scheduler, the learned-`state` ladder, or the v1/v2 memorization data shape.**
- **Any change** to any shipped Step 4–12 tool or route beyond the additive Test-mode surface and the new
  grade route.

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
