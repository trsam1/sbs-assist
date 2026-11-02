# Requirements: Memorize the Scroll — spaced-repetition scheduler (v2)

## Context and assumptions

Issue #69 asks for the **v2 scheduler** promised when the Memorize the Scroll tool shipped: turn the
per-chunk learned-state into a **review schedule** so a student memorizing a book is pulled back to the
chunks that are *due*, and keeps a whole book memorized over weeks instead of cramming once. The v1
tool (`.kiro/specs/memorize-the-scroll/`, shipped) persists one Memorization Study per scroll per user
holding an ordered list of chunks, each `{ start, end, verseRef, state }`, where `state ∈
{new, learning, chained, solid}` is set **by hand** and carries **no timing**. v2 adds the timing and
the scheduling math.

This is a refinement of the shipped tool, additive to its persisted model and its single CRUD Lambda —
**no new table, no new Lambda, no CDK resource delta, no AI**. The scheduling algorithm is **SM-2**
(SuperMemo 2), the original spaced-repetition scheduler: each item's review interval grows per
successful recall and resets on a miss, so well-known chunks need only occasional maintenance while
shaky ones return daily.

The **daily outbound reminder** (email/push "N chunks of <book> are due today") is explicitly **NOT**
in this spec — it needs net-new scheduler + notification infrastructure (no EventBridge/cron/SES
exists in the repo) and a cost line, so it is tracked separately as issue #68 (`needs-spec`) and
depends on this scheduler shipping first. v2 delivers the value **in-app**: the "due today" queue is
computed client-side every time the student opens the tool.

### What v2 is (and is NOT)

- It **is**: additive per-chunk scheduling fields (SM-2 ease/interval/repetitions + due/last-reviewed
  dates), a pure client **SM-2 helper** (`srs.ts`) that computes the next schedule from a graded
  recall, a **"due today" queue** surfaced at the top of the memorize view, and a **three-button grade
  control** (*Hard / Good / Easy*) on the drill that runs SM-2, updates the chunk, and saves.
- It is **NOT**: a daily email/push reminder (issue #68), an AI tool (no Bedrock), a new
  table/Lambda/route, or a change to the learned-state ladder (the `new → learning → chained → solid`
  axis stays; scheduling is a *separate* axis layered beside it).

### The two axes of a chunk (kept distinct)

v1's `state` ladder is the **learned axis** — *how well the student knows this chunk*, set by hand. v2
adds the **scheduling axis** — *when this chunk is next due for review*, computed by SM-2. They are
orthogonal on purpose: a chunk can be `solid` **and** come due for a maintenance review (that is
exactly what keeps a book memorized). v2 does not collapse one into the other.

### Assumptions (flagged for the design review; each the lowest-risk reading of the issue)

- **A1 — additive fields on the existing `MemorizationChunk`, all optional.** v2 adds
  `easeFactor?`, `intervalDays?`, `repetitions?`, `dueDate?`, `lastReviewed?` to the chunk. A v1 chunk
  with none of these reads as **"never reviewed → due now, ease 2.5"**. No field is renamed or removed;
  the persisted shape stays backward-compatible and the same `GET`/`PUT /scroll-studies/{id}/memorize`
  serves it.
- **A2 — SM-2 lives in a pure, Angular-free, AWS-free helper** (`src/app/memorize-view/srs.ts`),
  unit-tested in isolation. The component and the server both treat the schedule fields as plain data.
- **A3 — three-button grade maps to SM-2 quality.** *Hard / Good / Easy* → quality **3 / 4 / 5**
  (all passing grades that still advance the schedule at different rates), plus an implicit **Again**
  (a miss, quality < 3) available when the student could not recall it — *Again* resets the chunk to a
  1-day interval. (Confirmed with the user: three-button granularity.)
- **A4 — "due" is computed client-side against today's date.** A chunk is **due** when it has no
  `dueDate` (never reviewed) or `dueDate <= today` (local date, date-only, no time-of-day). The
  due-today queue is derived in the view; the server stores dates but computes no schedule.
- **A5 — grading persists.** Grading a chunk runs SM-2 in `srs.ts`, writes the new
  ease/interval/repetitions/dueDate/lastReviewed onto that chunk, and saves via the existing `PUT`
  (so the schedule survives sessions). A grade is the only thing that changes the scheduling fields.
- **A6 — the learned-state ladder is untouched behaviourally.** The student still sets `state` by hand
  as in v1; v2 neither drives it from grades nor removes it. (A convenience that nudges `state` on a
  grade is explicitly out of scope — kept orthogonal.)
- **A7 — no new infra, no reminder.** No table, Lambda, route, EventBridge, SES, or StageConfig change.
  The outbound daily reminder is issue #68, not this spec.

---

## Requirement 1: Add scheduling fields to each chunk, additively and backward-compatibly

### User Story
As a Bible student memorizing a book, I want each chunk to remember when I last reviewed it and when it
is next due, so the app can schedule my review instead of my guessing what to revisit.

### Acceptance Criteria
1. The `MemorizationChunk` model SHALL gain the optional fields `easeFactor` (number), `intervalDays`
   (number), `repetitions` (integer ≥ 0), `dueDate` (ISO date string, `''`/absent = due now), and
   `lastReviewed` (ISO date string, `''`/absent = never). All are **optional and additive** — a v1
   chunk persisted without them SHALL remain valid.
2. A chunk lacking scheduling fields SHALL be interpreted as **never reviewed**: due now, `easeFactor`
   defaulting to `2.5`, `repetitions` to `0`, `intervalDays` to `0`.
3. The feature SHALL add **no** new verse text and SHALL keep the "offsets only, no verse text"
   invariant: the new fields are numbers and dates only.
4. The existing `GET`/`PUT /scroll-studies/{scrollStudyId}/memorize` SHALL carry the new fields; **no
   new route, table, or Lambda** is added.

---

## Requirement 2: Compute the next review schedule with SM-2 (pure helper)

### User Story
As a Bible student, I want chunks I recall well to come back less often and chunks I miss to come back
soon, so my review time goes where it is needed.

### Acceptance Criteria
1. A pure function in `srs.ts` SHALL, given a chunk's current `{ easeFactor, intervalDays, repetitions }`
   and a recall **quality** `q ∈ {0..5}`, return the next `{ easeFactor, intervalDays, repetitions }`
   per SM-2:
   - IF `q < 3` (a miss) THEN `repetitions → 0` and `intervalDays → 1`.
   - ELSE `repetitions → repetitions + 1`, and `intervalDays →` `1` for the first success, `6` for the
     second, else `round(intervalDays × easeFactor)`.
   - On every grade, `easeFactor →` `max(1.3, easeFactor + (0.1 − (5−q)×(0.08 + (5−q)×0.02)))`.
2. A function SHALL compute the next `dueDate` as **today + `intervalDays` days** (date-only, local),
   and set `lastReviewed` to today.
3. The SM-2 helper SHALL be **pure** — no Angular, no `Date.now` baked in (today is passed in or
   injected), no AWS, no network — so it is unit-tested deterministically.
4. `easeFactor` SHALL never fall below `1.3`; `intervalDays` SHALL be a positive integer after any
   grade; `repetitions` SHALL be a non-negative integer.
5. The three-button grade SHALL map **Hard → 3, Good → 4, Easy → 5**, and an **Again** (could-not-
   recall) action SHALL map to a miss (`q = 2`, i.e. `< 3`).

---

## Requirement 3: Surface a "due today" queue and grade a review

### User Story
As a Bible student, I want to open the tool and immediately see which chunks are due for review today
and grade my recall, so I can do today's review without deciding what to revisit.

### Acceptance Criteria
1. The memorize view SHALL show a **"due today" summary** — the count and the ordered list of chunks
   whose `dueDate` is absent/`''` or `<= today` (date-only), in due order (soonest first, then by
   chunk order) — above the chunk editor.
2. The due queue SHALL be derived **client-side** from the persisted chunks and today's date; the
   server computes no schedule and the queue is not persisted.
3. From the drill surface, the student SHALL grade the active chunk with a **three-button control
   (Hard / Good / Easy)** plus an **Again** action; grading SHALL run the SM-2 helper, update that
   chunk's `easeFactor`/`intervalDays`/`repetitions`/`dueDate`/`lastReviewed`, and persist via the
   existing `PUT`.
4. After a grade, the due-today queue and the chunk's next-due label SHALL update to reflect the new
   schedule (e.g. "next due in 6 days").
5. Grading SHALL be **client-side only for the math** (the SM-2 computation); the only server call is
   the existing save. No AI, no new endpoint.
6. The scheduling axis SHALL be presented **beside**, not merged into, the learned-`state` ladder:
   grading updates the schedule; it does NOT silently change `state` (the student still owns `state`).
7. A study with zero chunks, or all chunks not yet due, SHALL show an empty/"nothing due today" state
   rather than an error.

---

## Requirement 4: Validate the new fields server-side

### User Story
As the maintainer, I want the server to validate the scheduling fields, so a malformed client cannot
persist a nonsensical schedule.

### Acceptance Criteria
1. The existing `parsePutBody` in `memorization-study` SHALL validate each chunk's new fields **when
   present** (all optional): `easeFactor` a finite number ≥ 1.3; `intervalDays` a non-negative integer;
   `repetitions` a non-negative integer; `dueDate` and `lastReviewed` each either `''` or an ISO date
   string (`YYYY-MM-DD` or a full ISO timestamp) within a sane length cap. A malformed value → `400`.
2. A chunk **without** the new fields SHALL remain valid (they are optional) — v1 payloads still save.
3. The server SHALL NOT compute or re-derive the schedule; it stores the fields as given (the SM-2 math
   is owned by the client `srs.ts`). It continues to own only structural validity.
4. All existing v1 validation (offsets, `verseRef`, `state`, cap) SHALL be unchanged.

---

## Non-Functional Requirements

1. **Stack conformance.** Frontend-plus-shared-model change only: the `memorize-view` component gains
   the due queue + grade control, a new pure `srs.ts` sits beside `chunking.ts`, the shared
   `MemorizationChunk` interface (both `src/app/models.ts` and `infra/lambda/shared/models.ts`) gains
   the optional fields, and the `memorization-study` Lambda's validator gains the optional-field
   checks. **No new table/Lambda/route, no `StageConfig`, no AI.**
2. **Additive & stateful-safe.** No CDK resource is added, replaced, or removed; the stateful guard
   stays clean and the table/function/log-group counts are **unchanged** (10 tables, 13 functions, 14
   log groups — as left by the v1 build). The `diff` job should show no `WordStudyToolStack` resource
   change.
3. **Backward compatibility.** v1 chunks (no scheduling fields) load and save unchanged and read as
   "due now, ease 2.5"; the service mapper coerces absent fields defensively.
4. **Copyright policy.** No Bible verse text is added; the new fields are numbers/dates. The invariant
   "offsets only, no verse text" holds.
5. **Cost.** Zero infra delta → zero new cost. (The reminder's cost lives in issue #68.)
6. **Accessibility.** The due-today queue, the three-button grade control, the Again action, and the
   next-due labels SHALL be keyboard operable and screen-reader labelled, matching the sibling editors'
   ARIA patterns.
7. **No test calls AWS or Bedrock.** Covered by the pure `srs.ts` tests, the mocked-DynamoDB Lambda
   validation tests, and the `memorize-view` component tests under the existing no-AWS harness.

---

## Out of Scope

- **The daily outbound reminder (email/push)** — issue #68 (`needs-spec`); needs net-new scheduler +
  notification infra and a cost line, and depends on this scheduler shipping first.
- **Driving the learned-`state` ladder from grades** — the schedule and the learned-state stay
  orthogonal; a "grade also bumps state" convenience is a possible later tweak, not v2.
- **A custom or configurable SM-2 variant** (per-user ease floors, fuzz, leech handling, a different
  algorithm) — v2 ships textbook SM-2.
- **Any AI / Bedrock call** — no AI grading or scheduling.
- **A new table, Lambda, route, EventBridge rule, or StageConfig field.**
- **Re-anchoring chunks after a scroll re-upload** — unchanged from v1 (still out of scope).
- **Any change** to the shipped Step 4–12 tools or their routes.

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
