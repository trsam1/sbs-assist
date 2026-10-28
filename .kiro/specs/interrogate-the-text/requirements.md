# Requirements: Interrogate the Text (Step 12 — Interrogation Study)

## Context and assumptions

Issue #60 asks for the **Interrogate the Text** tool for inductive-study **Step 12**, an
Interpretation-phase step. After observing and structuring the book, the student *interrogates* a
passage — asks it questions and records the answers found **in the text itself** — building a saved
Q&A worksheet per book. `product.md` tags Step 12 a *candidate*: "question bank + saved Q&A per
passage."

This is a new, self-contained tool folded into the shipped **Book Study hub**, following the exact
pattern of the shipped Step 6–10 step views (a scroll-nested route, gated on a `ready` scroll, one
persisted record per scroll per user). It is the **leanest** new tool to date: a flat ordered list
of Q&A entries, **no AI and no Bible verse text**.

### What the tool is (and is NOT)

- It **is**: a worksheet where the student writes their own question, assigns it a **category** (one
  of the 5 Ws + H, or Other), optionally **tags** it with subjects, points it at a **passage
  location**, and records their **answer** from the text.
- It is **NOT**: a canned question bank, an AI question generator, or an AI answer source. There are
  **no pre-written questions** (canned or AI) and **no Bedrock call at all** — a deliberate scope
  decision by the user. The only seeded content is a short list of **suggested tags** offered as
  autocomplete (the student may type any tag).

### The two axes (decided with the user)

The user distinguished two different things that a single field would have conflated:

- **Category** — *what KIND of question is this?* A fixed, closed set: `who`, `what`, `when`,
  `where`, `why`, `how`, `other`. Exactly **one** per entry, required. Renders as a `<select>`.
- **Tags** — *what SUBJECTS does this Q&A touch?* **Zero-to-many** per entry, **user-extensible**,
  and the axis the student **filters/surfaces** on (e.g. show everything tagged `about-God`). A
  small suggested-tag list is seeded as autocomplete only; the student may invent any tag.

### Assumptions (flagged for the design review; each the lowest-risk reading of the issue)

- **A1 — new tool, hub-folded, mirrors the sibling step views.** A new `InterrogationStudies`
  table + an `InterrogationStudyFn` CRUD Lambda (copying `structure-study`/`figures-study`), one
  record per `(scrollStudyId, userId)`, reached from the Book hub as "Step 12 — Interrogate the
  Text", gated on a `ready` scroll. New lazy route `scroll/:scrollStudyId/interrogate`.
- **A2 — no AI, no verse text.** No Bedrock call, no `StageConfig` field, no second Lambda. The
  student writes every question and answer; `passageRef` is a free-text location the student types;
  the app serves, embeds, and stores **no** Bible verse text.
- **A3 — category is a fixed closed set, server-validated.** `who|what|when|where|why|how|other`,
  one per entry, required. A client-owned constant is the single source of truth, asserted by a test
  and validated by the server.
- **A4 — tags are free-form, normalized, user-extensible.** Stored lower-cased, trimmed,
  de-duplicated, order preserved, blanks dropped; each ≤ 40 chars; capped (~20 per entry). A small
  seeded **suggested-tag** list (about-God, about-people, command, promise, warning, context,
  cross-reference) feeds a `<datalist>` for autocomplete; it is a suggestion source, not a closed
  set, and carries no pre-written questions.
- **A5 — filtering within a study.** The view offers a tag filter: selecting a tag shows only
  entries carrying it, so the student can surface a subject (e.g. `about-God`) **within this
  passage's interrogation**. Cross-*passage*/book-wide tag rollup is a later increment (out of
  scope here).
- **A6 — ordered, student-authored, optional list.** The student adds/edits/reorders/removes
  entries; order preserved as saved; an empty list is valid and saves.

---

## Requirement 1: Record interrogation Q&A entries

### User Story
As a Bible student, I want to ask questions of a passage and record the answers I find in the text,
so that I interrogate the book systematically rather than skimming it.

### Acceptance Criteria
1. The system SHALL let the student add an **interrogation entry** with: a `question` (required
   free text, ≤ 500); a `category` (required; one of `who|what|when|where|why|how|other`); zero or
   more `tags` (free-text subjects); an optional `passageRef` (free-text location, e.g. "2:7";
   **location only**, ≤ 50); an optional `answer` (the student's answer from the text, ≤ 4000); and
   optional `notes` (≤ 1000).
2. The `category` SHALL be chosen from the fixed closed set via a picker; a save with a category
   outside the set SHALL be rejected (`400`).
3. `tags` SHALL be free-text and user-extensible: the student MAY type any tag, MAY pick from a
   seeded suggested-tag list offered as autocomplete, or both. Tags SHALL be stored normalized —
   trimmed, lower-cased, de-duplicated, order preserved, empty tags dropped — and SHALL render as
   compact chips, with the tag editor staying unobtrusive when an entry has no tags.
4. The student SHALL be able to edit, reorder, and remove entries before and after saving; order
   SHALL be preserved as saved.
5. `question` and `category` are required per entry; a blank `question` SHALL block save (surfaced
   inline, not silently dropped); an entry whose `question` is blank on save SHALL be dropped from
   the persisted list (mirroring the sibling views' empty-row handling).
6. The feature SHALL serve, embed, or store **no** Bible verse text; `passageRef` is a free-text
   reference the student types. No AI/Bedrock call is made anywhere in this tool.

---

## Requirement 2: Filter/surface entries by tag

### User Story
As a Bible student, I want to filter my interrogation by subject tag, so I can surface everything I
noticed about a theme (e.g. what the passage reveals about God) in one place.

### Acceptance Criteria
1. The view SHALL offer a tag filter built from the tags currently in use on the study's entries.
2. WHEN the student selects one or more tags THEN the list SHALL show only entries carrying (all of)
   the selected tags; clearing the filter SHALL restore the full list.
3. The filter SHALL be a view-only concern — it SHALL NOT change what is persisted, and SHALL survive
   edits within the session but need not persist across reloads.
4. Cross-passage/book-wide tag rollup is OUT OF SCOPE for this increment (a later book-hub feature).

---

## Requirement 3: Persist and resume the interrogation study

### User Story
As a Bible student, I want my interrogation saved with the rest of my book study, so I can close the
app and return to it later.

### Acceptance Criteria
1. The system SHALL persist exactly one **Interrogation Study** per `(scrollStudyId, userId)`,
   holding an ordered list of entries, via `GET`/`PUT /scroll-studies/{scrollStudyId}/interrogate`,
   keyed exactly like the sibling studies (`PK = USER#<sub>`, `SK = INTERROGATE#<scrollStudyId>`).
2. WHEN the student saves THEN the `PUT` SHALL include the full `entries` list and the saved state
   SHALL reflect it (timestamps updated; first save sets `createdAt === updatedAt`, a later save
   preserves `createdAt` and advances `updatedAt`).
3. WHEN the student opens a scroll with no saved interrogation study (`404`) THEN the system SHALL
   present an empty editable worksheet.
4. The tool SHALL be reached from the Book hub as "Step 12 — Interrogate the Text", gated active
   only when the scroll is `ready`; the `uploading`/`extracting` states SHALL show a "preparing"
   message with a back link, and `failed`/404 an explanatory message with a back link — the same
   state model as the sibling views.

---

## Requirement 4: Validate interrogation entries server-side

### User Story
As the maintainer, I want the server to validate interrogation entries, so a malformed client cannot
persist bad data.

### Acceptance Criteria
1. `entries` SHALL be an optional array on the `PUT` body (absent → stored `[]`); order preserved.
2. Each entry SHALL be validated: `question` a non-empty string ≤ 500; `category` ∈
   `{who,what,when,where,why,how,other}`; `tags` an optional array of strings, each ≤ 40, the array
   capped (≤ 20), normalized server-side (trim, lower-case, de-dupe, drop empties); `passageRef` ≤
   50; `answer` ≤ 4000; `notes` ≤ 1000; a bad item → `400` with a message, the student's values kept
   client-side.
3. Validation SHALL follow the existing handlers' `parseSaveBody`/`parsePutBody` approach
   (JSON-parse in `try/catch`, reject non-objects/`null` → `400`). `userId` SHALL be taken only from
   the Cognito `sub` claim; any body `userId` SHALL be ignored.

---

## Non-Functional Requirements

1. **Stack conformance.** Frontend SHALL use Angular 21 standalone components with signals and
   Bulma, in a new `interrogate-view` component. Backend SHALL be a new `InterrogationStudyFn` CRUD
   Lambda + the shared models + a new `InterrogationStudies` table, mirroring `structure-study` —
   **no AI, no second Lambda, no `StageConfig` field**.
2. **Auth and scoping.** The route requires the Cognito authorizer and derives `userId` from the
   token `sub`; the existing `user-id.interceptor.ts` already matches `/scroll-studies/...` so no
   interceptor change is needed.
3. **Copyright policy.** The feature serves/embeds/stores no Bible verse text; `passageRef` is a
   student-typed location only. No Bedrock call is introduced.
4. **Additive infra.** A new table + function, both additive; `removalPolicy` =
   `config.statefulRemovalPolicy` (`Retain` in prod), no GSI, no PITR. The stateful guard stays
   clean (new protected resource, allowed). Counts: tables 8 → 9, functions 11 → 12, function
   log-groups 12 → 13.
5. **Cost.** One on-demand table + one small CRUD Lambda; no Bedrock. Negligible, and $0 when dev is
   destroyed.
6. **Accessibility.** The entry editor, category picker, tag chips/editor, and tag filter SHALL be
   keyboard operable and screen-reader labeled, matching the sibling editors' ARIA patterns.
7. **No test calls AWS or Bedrock.** Covered by the mocked-DynamoDB Lambda tests and the
   `interrogate-view` component tests under the existing no-AWS harness.

---

## Out of Scope

- **Any canned or AI-generated questions** — the student authors every question; no question bank
  content, no Bedrock call anywhere in this tool (explicit user decision).
- **AI answer generation or assistance** — none.
- **Cross-passage / book-wide tag surfacing** — this increment filters within one scroll's
  interrogation; a book-level tag rollup is a later feature.
- **Fetching, embedding, or serving any Bible verse text**, including for `passageRef`.
- **A dedicated navbar surface** — reached from the Book hub step list.
- **Any change** to the shipped Step 4–10 tools, the Word Study, or their routes.

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
