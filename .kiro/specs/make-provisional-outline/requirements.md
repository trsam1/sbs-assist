# Requirements: Make a Provisional Outline (Step 8 — Outline Study)

> **Revision (R2).** The first shipped Step 8 (PR #42) modelled the outline as a single flat,
> indented list of titled nodes carrying a `level`. User feedback: that hides the *process*. The
> way the method is actually worked — and the way the student works it in a spreadsheet — is a
> **left-to-right flow**: a fixed leftmost column of **paragraphs** (the atomic building block),
> then columns to the right that **merge adjacent paragraphs into labelled groupings**, and so on.
> This revision **replaces** the data model (`OutlineNode[]` → `OutlineParagraph[]` +
> `OutlineGrouping[]`) and the view (indented list → left-to-right flow). Groupings span
> **contiguous paragraphs only**. The auto-derived standard outline form (I / A / 1 / a) is kept
> and becomes a projection of the new structure. Step 8 shipped only hours earlier and has no
> real user data, so the clean model change is cheap now.

## Context and assumptions

Issue #40 asks for the **Step 8 — Make a Provisional Outline** tool (an **Outline Study**), the
next unshipped Observation step after the shipped **Structure Study** (Step 7). Step 7 lets a
student name a book's genre and tone and divide it into ordered **sections** (each with a label,
start/stop passage reference, and notes). Step 8 is where the student turns that structure into a
working **outline** of the book's flow of thought.

The inductive method (`Steps to Bible Knowledge`, James G. McCarthy) breaks Step 8 into **six
sub-steps**:

1. **List the paragraphs** of the book.
2. **Title each paragraph** (3–6 words, drawn from its topic sentence / main idea).
3. **Bracket** similar sequential paragraphs together.
4. **Title the brackets.**
5. **Group** further (brackets into larger units).
6. Put it in **standard outline form** (I / A / 1 / a).

Sub-steps 1–2 build the **leftmost column**: one row per paragraph, each marked with its
start/stop passage reference and a single-statement **main idea**. Sub-steps 3–5 are **merges to
the right**: the student selects a contiguous run of adjacent paragraphs, merges them into one
**grouping**, and titles it; groupings in turn merge into larger groupings in the next column.
Sub-step 6 is the **read-out**: the merge structure rendered in standard outline form, which the
software derives.

Software's role is to hold that left-to-right structure and number it, never to decide the
outline. The student writes every main idea and title and makes every merge call. This is the same
"software surfaces structure, the student makes every judgment" stance the shipped Step 4–7 tools
take, and the same copyright stance: the tool stores the student's own **main ideas, titles, and
passage locations only — never verse text** — and sends nothing to any AI prompt.

This feature mirrors the shipped **Structure Study** (`.kiro/specs/analyze-book-structure/`)
precisely at the infrastructure layer: one persisted record per scroll per user, keyed by
`scrollStudyId`, reached from the scroll, served by the existing `OutlineStudy` CRUD Lambda behind
the Cognito-authorized API Gateway, backed by the `OutlineStudies` DynamoDB table. **No new table,
Lambda, route, or function is added by this revision** — only the shape of the record stored in the
existing table changes, and the frontend that reads/writes it.

Assumptions (flagged for design review; each is the lowest-risk reading of the feedback):

- **A1 — paragraphs are the primitive and live in a fixed leftmost column.** The persisted record
  carries an ordered `paragraphs: OutlineParagraph[]`. Each paragraph has a `startRef`, `endRef`,
  a required `mainIdea` (the single-statement main idea / working title, ≤ 200), and optional
  `notes`. Paragraph order is the reading order of the book and is the ground truth every grouping
  references.
- **A2 — groupings are contiguous paragraph spans arranged in columns to the right.** A
  `grouping` has a `column` (1 = the first merge column of brackets, 2 = the next, …), a
  contiguous `[startIndex, endIndex]` span over the **paragraph** array, a required `title`
  (≤ 200), and optional `notes`. "Merging rows" in the spreadsheet = one grouping spanning several
  paragraphs. **Contiguous only**: a grouping's span is a single unbroken run of adjacent
  paragraphs; a grouping may not skip paragraphs. Higher columns likewise span a contiguous run
  of the paragraph range they cover. This matches a spreadsheet merge and keeps the standard-form
  derivation unambiguous.
- **A3 — the standard outline form is derived, never persisted.** The I / A / 1 / a labels are a
  pure function of the paragraphs and the column groupings: the deepest-column grouping that
  covers a paragraph is the top division, the next column in is the next level, down to the
  paragraph as the leaf. Nothing about the numbering is stored, so there is nothing to migrate.
- **A4 — seed from Step 7 without re-entry.** When the student has a saved `StructureStudy` for
  the same scroll and an empty outline, the tool offers to **import the Step 7 `sections`** as the
  initial **paragraphs**, carrying over each section's `label` → `mainIdea` and its
  `startRef`/`endRef`/`notes`. Import is an explicit, student-triggered action, never automatic,
  and never overwrites a non-empty outline.
- **A5 — standard outline numbering is I / A / 1 / a, cycling for deeper columns.** The topmost
  division level → uppercase Roman (I, II), the next → uppercase letter (A, B), then arabic
  (1, 2), then lowercase letter (a, b); still-deeper levels reuse the arabic/lowercase cycle. A
  deliberately bounded, documented rule, not an open numbering engine.
- **A6 — no new Bible text and no server-side text processing.** Step 8 derives nothing from the
  scroll text itself — it operates on the student's own main ideas, titles, and the Step 7
  sections. The scroll text is read only to gate on a `ready` scroll, not parsed. The backend
  stays a single CRUD surface.

## Requirements

### Requirement 1 — Open the Outline Study for a ready scroll

**User story:** As a student, I want to open an outline worksheet for a book whose scroll is ready,
so that I can build its provisional outline.

#### Acceptance criteria

1. WHEN the student navigates to `/scroll/:scrollStudyId/outline` AND the scroll study `status` is
   `ready` THEN the system SHALL show the Outline Study worksheet for that scroll.
2. WHEN the scroll study `status` is `uploading` or `extracting` THEN the system SHALL show a
   "scroll text still being prepared" message and a back link to `/scroll/:scrollStudyId`, and SHALL
   NOT show the worksheet (mirroring `structure-view`).
3. WHEN the scroll study `status` is `failed`, OR the scroll study is not found (404) THEN the
   system SHALL show an explanatory message and a back link to `/scrolls`.
4. WHEN the worksheet opens THEN the system SHALL fetch any saved Outline Study for the scroll; a
   404 (none saved yet) SHALL present an empty, editable worksheet without an error.

### Requirement 2 — List, title, and edit paragraphs (the leftmost column)

**User story:** As a student, I want to list the book's paragraphs — each with its start/stop
references and a one-line main idea — so that I have the atomic rows the whole outline is built on.

#### Acceptance criteria

1. WHEN the student adds a paragraph THEN the system SHALL append a new paragraph with empty
   `startRef`, `endRef`, `mainIdea`, and `notes` at the end of the paragraph column.
2. WHEN the student edits a paragraph's `startRef`, `endRef`, `mainIdea`, or `notes` THEN the
   system SHALL update only that paragraph, preserving order and all other fields.
3. The system SHALL enforce field length limits: `mainIdea` ≤ 200 (required, non-empty to persist),
   `startRef`/`endRef` ≤ 50, `notes` ≤ 1000.
4. WHEN the student reorders a paragraph (up/down) THEN the system SHALL move it and SHALL
   correspondingly adjust every grouping span so each grouping still covers the same paragraphs; a
   reorder that would split a grouping into a non-contiguous span SHALL be prevented or SHALL
   shrink the affected grouping to the contiguous remainder (design decides the exact rule; it must
   never leave a grouping spanning non-adjacent paragraphs).
5. WHEN the student removes a paragraph THEN the system SHALL remove it, shift later paragraph
   indices down by one, and update or drop any grouping whose span referenced it, never leaving a
   grouping with a non-contiguous or empty span.

### Requirement 3 — Merge paragraphs into groupings, column by column (bracket and group)

**User story:** As a student, I want to select a contiguous run of paragraphs and merge them into a
labelled grouping in the next column to the right, and merge groupings again further right, so that
I bracket related paragraphs and group them into larger divisions (sub-steps 3–5).

#### Acceptance criteria

1. WHEN the student selects two or more **contiguous** paragraphs and merges them THEN the system
   SHALL create a column-1 grouping spanning exactly `[startIndex, endIndex]` of the paragraph
   column, with an empty `title` the student then fills.
2. The system SHALL only allow a merge over a **contiguous** run of adjacent paragraphs; it SHALL
   reject or disable a merge whose selection skips a paragraph.
3. WHEN the student merges adjacent column-N groupings THEN the system SHALL create a column-(N+1)
   grouping spanning the union of their paragraph ranges, which is contiguous by construction.
4. WHEN the student edits a grouping's `title` or `notes` THEN the system SHALL update only that
   grouping.
5. WHEN the student un-merges / removes a grouping THEN the system SHALL remove it without touching
   the paragraphs it covered or any grouping in a different column that still has a valid contiguous
   span.
6. The system SHALL render the paragraphs and groupings as a **left-to-right flow**: the paragraph
   column on the left, each merge column to its right, so a grouping visually spans the rows of the
   paragraphs it covers (the "merged cells" layout the student draws in a spreadsheet). It need not
   be a literal HTML table, but it SHALL make the span relationship visible.

### Requirement 4 — Render standard outline form

**User story:** As a student, I want to see my paragraphs and groupings numbered in standard
outline form, so that I have the finished Step 8 artifact.

#### Acceptance criteria

1. WHEN the worksheet renders THEN the system SHALL compute a standard outline label for each
   grouping and paragraph from the column structure: the highest-numbered column that covers a
   paragraph is the top division level, descending columns are deeper levels, and the paragraph is
   the leaf. Level 0 → uppercase Roman, 1 → uppercase letter, 2 → arabic, 3 → lowercase letter;
   deeper reuses the arabic/lowercase cycle.
2. The outline-label computation SHALL be a **pure, client-side function** of the paragraphs and
   groupings, persisting nothing and introducing no Bible text.
3. The system SHALL restart sibling numbering under each new parent (e.g. the first child of a new
   division is "A", not a continuation).
4. A paragraph not covered by any grouping SHALL still receive a label at the top division level,
   so an outline with no merges yet still renders a flat I / II / III list.

### Requirement 5 — Seed from the Step 7 Structure Study

**User story:** As a student who finished Step 7, I want to import my sections as the starting
paragraphs, so that I don't re-type the structure I already drew.

#### Acceptance criteria

1. WHEN a saved `StructureStudy` exists for the scroll AND the Outline Study has no saved
   paragraphs THEN the system SHALL offer an explicit "Import sections from Step 7" action.
2. WHEN the student triggers the import THEN the system SHALL create one paragraph per Step 7
   section, in order, copying each section's `label` → `mainIdea` and its
   `startRef`/`endRef`/`notes`, and SHALL create no groupings (the student merges them).
3. The import SHALL be student-triggered only (never automatic) and SHALL NOT overwrite an outline
   that already has paragraphs; when paragraphs exist, the action is hidden or disabled with an
   explanation.
4. WHEN no `StructureStudy` exists for the scroll THEN the import action SHALL be absent, and the
   student SHALL still be able to build the outline from scratch.

### Requirement 6 — Persist and reload the outline

**User story:** As a student, I want to save my outline and reopen it later, so that it is a
re-openable worksheet.

#### Acceptance criteria

1. WHEN the student saves THEN the system SHALL `PUT` the full worksheet (ordered paragraphs and
   their groupings) to `/scroll-studies/{scrollStudyId}/outline` and show a save confirmation.
2. The system SHALL drop paragraphs left with an empty `mainIdea` before persisting, SHALL drop
   groupings with an empty `title`, SHALL re-validate that every surviving grouping still spans a
   contiguous paragraph run after the drops, and SHALL reflect the server-normalised worksheet
   after save.
3. WHEN a save fails THEN the system SHALL keep the student's entered values and show an error
   without losing work.
4. The server SHALL set `userId` (from the Cognito authorizer) and `createdAt`/`updatedAt`; the
   client SHALL NOT send them.

### Requirement 7 — Backend CRUD stays additive and stateful-safe

**User story:** As the system owner, I want the Outline Study record-shape change to deploy safely
onto the live stack, so that it is consistent and introduces no infrastructure churn.

#### Acceptance criteria

1. The system SHALL reuse the existing `OutlineStudies` table, `OutlineStudy` Lambda, and
   `GET`/`PUT /scroll-studies/{scrollStudyId}/outline` routes. **No new table, function, route, or
   log group is added** (DynamoDB table count stays 7, Lambda count stays 9).
2. The Lambda SHALL validate the new record shape server-side: `paragraphs` an array, each with a
   non-empty `mainIdea` ≤ 200, `startRef`/`endRef` ≤ 50, `notes` ≤ 1000; `groupings` an array, each
   with an integer `column ≥ 1`, integer `startIndex`/`endIndex` with
   `0 ≤ startIndex ≤ endIndex < paragraphs.length`, a non-empty `title` ≤ 200, `notes` ≤ 1000.
   Any violation → 400, mirroring the existing validator's style.
3. The Lambda SHALL reject a grouping whose span is out of range or inverted, so a persisted record
   can never carry a non-contiguous or dangling span.
4. The change to the stored item shape SHALL require no schema migration (the table is schemaless;
   the only existing records are from PR #42 and carry no real user data).

## Out of scope

- Generating paragraphs, main ideas, titles, or groupings automatically — the student authors
  every one and decides every merge.
- Step 9 (State a Provisional Theme and Purpose) capture.
- Any new source of Bible text, or any server-side parsing of the scroll text.
- Non-contiguous groupings — a grouping is always a single contiguous run of paragraphs.
- A free-standing outline collection, list view, or cross-scroll outline.
