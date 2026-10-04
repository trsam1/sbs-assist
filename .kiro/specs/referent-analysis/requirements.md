# Requirements: Referent Analysis (Step 6 — Identify Antecedents, Referents, Audience, and Speaker)

## Context and assumptions

Inductive-study **Step 6** asks the student, among other things, to identify **referents** — the
person or thing a descriptive phrase stands for (e.g. "the ruler of this world" → Satan). This
spec adds the ability for a student to **document the referent phrases they find in a study and
record what each one refers to**, with their own notes and an optional scroll-text reference
(a location in the book where the phrase occurs).

This is the referent sibling of the planned Step 6 pronoun work (issue #20,
`.kiro/specs/parse-scroll-for-pronouns/`), but it differs in kind: #20 **derives** a pronoun
worklist on demand from scroll text and persists nothing, whereas this feature **persists the
student's own interpretive work** (the referent phrase, what it refers to, notes). It is therefore
a stored, re-openable list, not a derived view.

**Where referents attach (assumption A1, flagged for the design review).** The product already has
a per-book container, the **Book Study** (`BookStudy`: "a user-owned container that organizes study
work by a book of the Bible", keyed by the Cognito user, with a `/books/:bookStudyId` detail page).
Step 6 is a per-book interpretive step, so a study's referent list is modelled as data **on the
Book Study record** and edited from the Book Study detail page. "A given study" in the issue is
therefore read as **a Book Study**. This reuses the existing `BookStudies` table, the `/books`
routes, the `book-study-crud` Lambda, and the book-study-detail component rather than introducing a
new entity. (The issue hints #23 — the Scroll Study — but the Scroll Study is a read-only
extracted-text artifact with no editable per-study list; it is a poor host for persisted
interpretive work. See A3 for how the scroll is still referenced.)

**Assumptions (each the lowest-risk reading of the issue; the design review can confirm):**

- **A1 — "a given study" = a Book Study.** Referents are stored on the `BookStudy` record and
  edited from `/books/:bookStudyId`.
- **A2 — a referent entry has three fields.** A **phrase** (required free text — the descriptive
  phrase found), a **refersTo** (required free text — what it stands for), and **notes** (optional
  free text). This matches the issue's "referent phrase", "what they refer to", and "notes for each
  entry".
- **A3 — the "scroll text reference" is an optional free-text location string**, not a foreign key
  to a Scroll Study. The issue says "optionally specify the scroll text reference for the
  referent"; the lowest-risk reading is a short free-text location the student types (e.g. "ch. 3,
  near the start"), because the book may have no Scroll Study and the product serves locations, not
  linked records. Linking to a specific Scroll Study record is Out of Scope.
- **A4 — this increment covers referents only.** Antecedents, audience, speaker, and point of view
  (the rest of Step 6) are not part of this feature (Out of Scope); so is any AI involvement.

---

## Requirement 1: Add a referent entry to a study

### User Story
As a Bible student, I want to freely enter a referent phrase and what it refers to and add it to a
list for a given Book Study, so that I can document the referents I find while working Step 6.

### Acceptance Criteria
1. WHEN the student opens a Book Study detail page THEN the system SHALL display a **Referents**
   section containing the study's existing referent entries (empty when none have been added) and a
   form to add a new entry.
2. The add-entry form SHALL provide a required **phrase** text input, a required **refers to** text
   input, an optional **notes** text area, and an optional **scroll text reference** text input.
3. WHEN the student submits the add-entry form with both the phrase and the refers-to filled THEN
   the system SHALL append the entry to the study's referent list and clear the form for the next
   entry.
4. WHEN the student submits the add-entry form with the phrase OR the refers-to empty (after trim)
   THEN the system SHALL show an inline validation message and SHALL NOT append an entry.
5. The phrase and refers-to inputs SHALL each be limited to 200 characters; the notes and
   scroll-text-reference inputs SHALL each be limited to 1000 characters; input beyond a limit SHALL
   be prevented or rejected with an inline message, and SHALL NOT be persisted.
6. The referent list SHALL preserve the order in which entries were added.

### Correctness Properties
- Property: For any form submission where `phrase.trim()` or `refersTo.trim()` is empty,
  `addReferent` is not called and the list length is unchanged.
- Property: For any valid add, the new entry appears last in the list and every other entry is
  unchanged.

---

## Requirement 2: Record notes and an optional scroll-text reference per entry

### User Story
As a Bible student, I want to provide notes for each referent entry and optionally note where in
the scroll the phrase occurs, so that I can capture my reasoning and find the phrase again.

### Acceptance Criteria
1. Each referent entry SHALL carry its own **notes** field (optional, multi-line) and its own
   **scroll text reference** field (optional, single line), both editable.
2. WHEN the student edits an entry's notes or scroll-text reference THEN the edited values SHALL be
   held in the study's working state and persisted on the next save (Requirement 3).
3. The notes and scroll-text-reference fields SHALL accept empty values and SHALL default to the
   empty string when not provided.
4. All per-entry fields SHALL support the same 200/1000-character limits defined in Requirement 1
   criterion 5.

### Correctness Properties
- Property: An entry created without notes or a scroll-text reference has `notes === ''` and
  `scrollRef === ''` (never `undefined`/`null`), so the stored shape is uniform.

---

## Requirement 3: Persist, re-open, and remove referent entries

### User Story
As a Bible student, I want my referent list saved with the study and restored when I re-open it, so
that my documented referents are not lost between sessions, and I want to remove entries I no longer
need.

### Acceptance Criteria
1. WHEN the student saves the referent section THEN the system SHALL persist the full referent list
   onto the Book Study record, scoped to the authenticated Cognito user, and SHALL update the
   study's `updatedAt` timestamp while preserving its `createdAt`.
2. WHEN the student re-opens a Book Study THEN the system SHALL display its persisted referent
   entries exactly as saved (phrase, refers-to, notes, scroll-text reference, and order).
3. WHEN the student removes a referent entry and saves THEN that entry SHALL no longer be present on
   re-open, and the remaining entries' order SHALL be preserved.
4. A Book Study saved before this feature shipped (no `referents` attribute) SHALL load as a study
   with an empty referent list, and SHALL NOT error.
5. A student SHALL only ever read or modify the referent list of their own Book Study; a request for
   another user's study SHALL return 404 (unchanged from the existing Book Study behaviour).
6. IF a save fails THEN the system SHALL show an error and SHALL retain the student's unsaved entries
   so they can retry without re-typing.

### Correctness Properties
- Property: For any referent list, saving a study and then getting it by id returns a record whose
  `referents` array equals the saved list (same entries, same order), with `userId` unchanged and
  `createdAt` preserved while `updatedAt` advances.
- Property: Reading a record that has no `referents` attribute yields `referents === []` (tolerant
  default), never a thrown error.

---

## Non-Functional Requirements

1. **Serverless-first / additive.** The referent list is a field on the existing `BookStudies`
   DynamoDB table, written through the existing `book-study-crud` Lambda; no new table, Lambda, S3
   object, or other AWS resource is introduced, and no new API route or CORS method is added
   (persisted via the existing `POST /books` upsert — see design). `infra/lib/stage-config.ts` is
   unchanged.
2. **No copyrighted-text policy unchanged.** The referent phrase, refers-to, notes, and scroll-text
   reference are the **student's own words and a free-text location**; the app serves no Bible text
   and places nothing in any AI prompt.
3. **Auth and scoping.** The referent list is read and written only through the authenticated
   `/books` path; a student can edit only their own study (404 for a study they do not own).
4. **Accessibility.** The Referents UI SHALL be keyboard operable and screen-reader labeled, matching
   the ARIA patterns the app already uses (`aria-label`, `role="alert"`, `aria-live`, labeled form
   controls, Bulma components).
5. **Cost.** Persisting the list reuses the existing single `PUT`/`GET` on `BookStudies`; no new
   per-request compute or storage is introduced.

---

## Out of Scope

- Antecedents, audience, speaker, and point of view (the rest of Step 6) — this increment persists
  **referents** only.
- Linking a referent entry to a specific **Scroll Study** record or validating the scroll-text
  reference against stored scroll text; the scroll-text reference is free text (assumption A3).
- Auto-detecting or suggesting referent phrases from the text (there is no parsing/NLP here; the
  student enters phrases themselves).
- Any AI summary or synthesis of referents (no Bedrock involvement).
- A dedicated top-level "Referents" navbar surface or a cross-study referent view; referents are
  edited within a Book Study.
- Changes to the Word Study tool, the Scroll Study tool, or the pronoun worklist (#20).
- An in-place edit of a referent's **phrase/refers-to** after it is added beyond what the per-entry
  fields allow is a design detail, not a separate requirement; see the design for the chosen edit
  model.
