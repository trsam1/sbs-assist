# Requirements: Capture secondary-genre spans (Step 7 — Structure Study enhancement)

## Context and assumptions

Issue #56 asks to let a student record **where a book's genre shifts inside the book** — a run of
poetry embedded in a narrative, a hymn inside a letter, an oracle inside a historical account. This
is a small, additive enhancement to the **shipped** Step 7 **Structure Study**
(`.kiro/specs/analyze-book-structure/`), **not** a new tool.

### Why this lands in Step 7, not a new Step 11 tool

The inductive method's Step 11 (Identify the Genre) was considered as its own tool and
**deliberately skipped**: the shipped Structure Study (Step 7) already captures the book's
**dominant genre** (a picker of the seven biblical genres plus free text) and its **tone**, backed
by the genre "characteristics table" in the Step 7 reference. A second genre picker would duplicate
that. The one genuine gap is **in-book genre transitions**, and the Step 7 reference itself frames
this as part of *structure* analysis, not a separate step:

> "A single book may contain more than one genre; naming the dominant genre, and **noting where
> others appear**, is part of analyzing the structure." (`docs/references/inductive-study-step-7.md`)

So the dominant genre stays the existing single `StructureStudy.genre` field (unchanged), and this
feature adds an optional, ordered list of **secondary-genre spans** alongside it — each a genre + a
location span + optional notes — mirroring the `sections` list already in the record.

### Assumptions (flagged for the design review; each the lowest-risk reading of the issue)

- **A1 — additive field on the shipped record, no migration.** A new optional
  `secondaryGenres: SecondaryGenre[]` field is added to the `StructureStudy` record, defaulting to
  `[]`. DynamoDB is schemaless and the record is read-then-write upserted, so existing Structure
  Studies load with an empty list and need **no backfill**. No new table, no new Lambda, no route
  change, no stateful-guard implication (the `StructureStudies` table is untouched in shape).
- **A2 — same genre vocabulary as the dominant-genre field.** A secondary-genre row's `genre` is
  chosen from the **same** suggested list the dominant-genre field offers (historical narrative,
  letter/epistle, poetry, prophecy, apocalyptic, wisdom, law) with free-text override, so there is
  one genre vocabulary across the worksheet. The list stays a client-owned constant (no new source).
- **A3 — locations only, never verse text.** A span's `startRef`/`endRef` are **free-text
  locations the student types** (e.g. "15:1", "15:1–21"); the app serves, embeds, and stores **no**
  Bible verse text, consistent with the product's constraints. `notes` is the student's own free
  text (e.g. "the Song of the Sea").
- **A4 — ordered, student-authored, optional.** The student adds, edits, reorders, and removes
  secondary-genre rows; order is preserved as saved; an empty list is valid and does not block
  saving. The tool records the student's observation and never infers a genre shift on its own
  (consistent with Step 7's "the student makes every structural call").
- **A5 — one focused change; nothing else in Step 7 moves.** This increment adds only the
  secondary-genre list and its editor block in the existing `structure-view`. It changes nothing
  about the dominant `genre`/`tone` fields, the frequency view, the markers, the sections, the
  elements chart, the table, the Lambda routes, or any other shipped step.

---

## Requirement 1: Record secondary-genre spans on a Structure Study

### User Story
As a Bible student, I want to record where the genre shifts inside a book — a passage of poetry in
a narrative, a hymn in a letter — so that my structural analysis captures the book's mixed genres,
not just its dominant one.

### Acceptance Criteria
1. The system SHALL let the student add a **secondary-genre span** to the Structure Study with: a
   `genre` (required; chosen from the same suggested biblical-genre list the dominant `genre` field
   offers, or free text), an optional `startRef` (free-text location, e.g. "15:1"; **location
   only**), an optional `endRef` (free-text location, e.g. "15:21"), and optional `notes` (free
   text, e.g. "the Song of the Sea").
2. The system SHALL present the secondary-genre editor **alongside** the existing dominant-genre
   field in the Structure Study worksheet, so it reads as "the book's dominant genre is X, and here
   is where other genres appear," not as a second dominant-genre picker.
3. The student SHALL be able to edit, reorder, and remove secondary-genre spans before and after
   saving; the order SHALL be preserved as saved.
4. `genre` is required per span; `startRef`, `endRef`, and `notes` are optional (empty stored as
   `""`). A span with a blank `genre` SHALL NOT be savable (surfaced inline, not silently dropped).
5. The secondary-genre list SHALL be **optional** — a Structure Study with no secondary-genre spans
   (an empty list) SHALL remain valid and SHALL save exactly as before.
6. The feature SHALL serve, embed, or store **no** Bible verse text; `startRef`/`endRef` are
   free-text references the student types, consistent with the whole app's locations-only rule.

---

## Requirement 2: Persist and resume secondary-genre spans

### User Story
As a Bible student, I want my secondary-genre spans saved with the rest of my Structure Study, so I
can close the app and return to them later.

### Acceptance Criteria
1. The Structure Study record SHALL gain an additive optional field `secondaryGenres` — an ordered
   list of secondary-genre spans (Requirement 1) — persisted with the existing
   `genre`/`tone`/`markers`/`sections`/`elements` on the same `(scrollStudyId, userId)` record.
2. WHEN the student saves the Structure Study THEN the `PUT` SHALL include `secondaryGenres` and the
   saved state SHALL reflect it (timestamps updated as today).
3. WHEN the student reopens a Structure Study saved **before** this feature (no `secondaryGenres`
   field) THEN the system SHALL present it with an **empty** secondary-genre list (no error, no
   migration) and allow the student to add spans.
4. WHEN the student reopens a Structure Study saved **with** secondary-genre spans THEN the system
   SHALL `GET` and render them in saved order.
5. The server SHALL set `userId` from the Cognito `sub` claim and SHALL ignore any `userId` in the
   request body (unchanged hardening); the server SHALL validate each secondary-genre span's fields
   (Requirement 3) and reject a malformed list with `400`, keeping the student's entered values.

---

## Requirement 3: Validate secondary-genre spans server-side

### User Story
As the maintainer, I want the server to validate secondary-genre spans the same way it validates the
other Structure Study lists, so a malformed client cannot persist bad data.

### Acceptance Criteria
1. `secondaryGenres` SHALL be an **optional array** on the `PUT` body (absent → stored `[]`); order
   preserved as sent.
2. Each span item SHALL be validated: `genre` a non-empty string ≤ 200; `startRef` ≤ 50; `endRef`
   ≤ 50; `notes` ≤ 1000; a bad item → `400` with a message, the student's values kept client-side.
3. Validation SHALL follow the existing `structure-study` handler's `parseSaveBody` approach
   (JSON-parse in `try/catch`, reject non-objects/`null` → `400`), identical in shape to how
   `sections` items are validated today.

---

## Non-Functional Requirements

1. **Stack conformance.** Frontend changes SHALL use Angular 21 standalone components with signals
   and Bulma, inside the existing `structure-view` component. Backend changes SHALL be a field
   addition to the existing `structure-study` CRUD Lambda and the shared models — **no** new table,
   Lambda, route, or `StageConfig` field, and **no** AI.
2. **Auth and scoping.** Unchanged — the structure route already requires the Cognito authorizer and
   derives `userId` from the token `sub`.
3. **Copyright policy.** The feature serves/embeds/stores no Bible verse text; `startRef`/`endRef`
   are student-typed locations only. No AI prompt is introduced (no Bedrock call at all).
4. **Additive / no migration.** The record change is purely additive; pre-existing Structure Studies
   load with an empty `secondaryGenres` list. The `StructureStudies` table's shape, removal policy,
   and PITR posture are unchanged, so the stateful guard is unaffected.
5. **Cost.** Zero new infrastructure; one more field on an existing on-demand DynamoDB item.
   Negligible.
6. **Accessibility.** The new editor block SHALL be keyboard operable and screen-reader labeled,
   matching the existing `sections`/`markers` editor ARIA patterns (`aria-label`, `aria-pressed`,
   `role="alertdialog"` for a destructive remove confirm, `is-sr-only`).
7. **No test calls AWS or Bedrock.** Existing no-AWS harness unchanged; the handler change is covered
   by the mocked-DynamoDB Lambda tests and the `structure-view` component test.

---

## Out of Scope

- **A new Step 11 "Genre" tool** — deliberately skipped; the dominant genre is captured by Step 7's
  existing `genre` field, and this feature adds only the in-book-transition gap to Step 7.
- **Moving the dominant `genre` out of Step 7** — the single `genre` field stays exactly as shipped;
  this is additive, not a re-model.
- **Any change** to the Step 7 frequency view, markers, sections, elements chart, or to any other
  shipped step (4–6, 8–10) or the Word Study.
- **AI classification of genre or genre shifts** — the student records the observation; no Bedrock
  call is added.
- **Fetching, embedding, or serving any Bible verse text**, including for the span references.
- **A dedicated navbar surface** — the editor lives inside the existing Structure Study worksheet.
- **Consuming secondary-genre spans downstream** (e.g. in Step 8 Outline or Step 10 Figures) — the
  data is captured and stored; any later consumer is a separate increment.

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
