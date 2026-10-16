# Requirements: Analyze the Structure of the Book (Step 7 — Structure Study)

## Context and assumptions

Issue #36 asks for a **Structure Study** tool for inductive-study **Step 7 — Analyze the
Structure of the Book**, the next unshipped Observation step (Steps 4, 5, and 6 are shipped).
Step 7 is where the student works out a book's genre, thesis, sections, and intro/conclusion by
looking for structural signals in the text. Much of that work is mechanical — counting repeated
words, spotting transitional phrases and direct address — which is exactly where software helps.
The tool lets a student capture that analysis as a saved worksheet, reading from the Step 4
scroll they already uploaded, and feeds naturally into Step 8 (Make a Provisional Outline).

The only running text of a book the app holds is the **extracted scroll text** produced by the
shipped **Scroll Study** tool (Step 4 — Observe the Text as a Scroll; see
`.kiro/specs/scroll-text-upload/`). A Scroll Study stores the student's own extracted `scrollText`
once its `status` is `ready`. This feature therefore takes a `ready` Scroll Study as its input,
derives a **repeated-word frequency** view from that already-persisted text in the browser (the
same client-side, dictionary-free approach the shipped **Parse Scroll for Pronouns** tool uses —
`.kiro/specs/parse-scroll-for-pronouns/`), and lets the student **persist** their own structural
judgments as a **Structure Study** record. It introduces no new source of Bible text and stores
no copyrighted text (the scroll text is the student's own uploaded document, already persisted and
scoped to them).

This feature does the first *interpretive* persisted work of Step 7, so — like the shipped
**Antecedent Study** (`.kiro/specs/antecedent-analysis/`) — it introduces a persisted record
scoped to one Scroll Study and one user: a **Structure Study**. The repeated-word frequency view
is **derived** on demand (nothing persisted, like the pronoun list); the student's **markers,
tone, sections, and elements** are **persisted** (a re-openable record, like the antecedent
assignments). Software surfaces candidates and captures the student's conclusions; it never
decides the structure.

Assumptions (flagged for the design review; each is the lowest-risk reading of the issue):

- **A1 — "the book's text" = a `ready` Scroll Study.** The book is identified by its existing
  `scrollStudyId`; the feature reads `scrollText` from that record and keys the Structure Study by
  that same `scrollStudyId`, exactly as the Antecedent Study is keyed (one Structure Study per
  scroll per user). A scroll that is not `ready` (`uploading`/`extracting`/`failed`) has no text to
  analyze and is handled explicitly (Requirement 1), mirroring the pronoun and antecedent views.
- **A2 — repeated-word frequency reuses the pronoun tool's tokenisation, not a new parser.** A
  "word" is a maximal `[A-Za-z]+` letter-run, lower-cased for counting, apostrophe as a token
  separator — the exact rule pinned by the pronoun spec (`parse-scroll-for-pronouns`
  Requirement 1). This is a frequency count over the student's own text, **not** a Bible
  concordance and **not** a grammatical parser. A short, client-owned **stop-word list** (common
  function words: the, and, of, to, a, in, that, is, …) is offered as a default-on filter so the
  "focus words" surfaced are content words, not articles; the student can toggle it off.
- **A3 — markers are student-recorded, software-suggested.** For transitional phrases, direct
  address, and strong declaratives, the tool offers *candidate* matches from a small, client-owned
  **signal-phrase list** drawn from the Step 7 reference (e.g. "now concerning", "finally",
  "therefore", "my brethren"), each with its location in the text. The student decides which
  candidates are real structural signals and may also add their own free-text markers. The tool
  never asserts a marker is structural on its own — it only surfaces candidates and persists the
  student's selections and notes.
- **A4 — tone, sections, and the elements chart are free-form captured, not computed.** Tone is
  free text. Sections are an ordered list of student-defined divisions (label + optional
  start/end reference + notes); the student draws the divisions, the tool does not infer them. The
  elements chart is **optional** (Requirement 6) and is a student-authored grid of elements against
  the sections/verses where they occur.
- **A5 — divisions are uninspired and the tool says so.** The Step 7 reference stresses that
  verse/paragraph/chapter divisions are uninspired and must be verified, not trusted. The sections
  UI SHALL carry a one-line reminder to this effect; the tool imposes no chapter/verse structure of
  its own.
- **A6 — one focused tool for one step; grouped under the book.** This increment delivers only
  Step 7 and changes nothing about the Step 4 Scroll Study, the Step 5 Word Study, or the Step 6
  Pronoun/Antecedent tools (Out of Scope). The Structure Study is reached contextually from a
  `ready` scroll, the same navigation pattern the pronoun and antecedent views use, and is
  associated with the book through that scroll (a Scroll Study already stands in for "the book").

---

## Requirement 1: Open a Structure Study for a ready scroll

### User Story
As a Bible student, I want to open a Structure Study for a book I have uploaded as a scroll, so
that I can analyze that book's structure using its text.

### Acceptance Criteria
1. WHEN the student opens the Structure Study view for a Scroll Study whose status is `ready` THEN
   the system SHALL load the scroll's `scrollText`, load any previously saved Structure Study for
   that `scrollStudyId` (via `GET`), and present the analysis surfaces (Requirements 2–6).
2. WHEN no Structure Study has been saved yet for that scroll THEN the system SHALL present an
   empty but editable worksheet (no error) initialised from the scroll text (the derived
   frequency view populates; markers/tone/sections/elements start empty).
3. WHEN the referenced Scroll Study status is `uploading` or `extracting` THEN the system SHALL
   show a non-blocking "the scroll text is still being prepared" message with a link back to the
   scroll view (`/scroll/:scrollStudyId`, which polls to completion) and SHALL NOT attempt to
   derive the frequency view, consistent with the pronoun view's `preparing` behaviour.
4. WHEN the referenced Scroll Study status is `failed`, or the study does not exist or does not
   belong to the user (API returns `404`) THEN the system SHALL show an explanatory message and a
   link back to the scroll list (`/scrolls`), and SHALL NOT attempt to analyze.
5. A student SHALL only ever load their own scroll and their own Structure Study; cross-user access
   SHALL be impossible (the API returns `404` for a scroll or record the Cognito `sub` does not
   own — same trust boundary as the scroll and antecedent paths).

---

## Requirement 2: Repeated-word frequency view (focus words)

### User Story
As a Bible student, I want to see which words repeat most in the book's text, so that I can spot
the book's focus words as a structural signal.

### Acceptance Criteria
1. WHEN the view loads a `ready` scroll THEN the system SHALL derive, in the browser from
   `scrollText`, the distinct words and their occurrence counts and display them ordered by count
   descending, then alphabetically ascending for ties (the same deterministic order the pronoun
   list uses).
2. The system SHALL treat a "word" as a maximal `[A-Za-z]+` letter-run, matched case-insensitively,
   with an apostrophe acting as a token separator — identical to the pronoun tool's tokenisation
   (`parse-scroll-for-pronouns` Requirement 1 criteria 3–4), so the two tools agree on what a token
   is.
3. The system SHALL provide a **stop-word filter** toggle (default **on**) that removes a fixed,
   client-owned set of common function words from the frequency view, so the surfaced focus words
   are content words; WHEN the toggle is off THEN all words (including function words) SHALL be
   counted and shown.
4. The system SHALL let the student bound the list to a top-N (e.g. a count or a "show more"
   affordance) so a long book does not render an unusably long list; the default view SHALL show
   the most frequent words first.
5. WHEN the scroll text is empty or whitespace-only THEN the system SHALL show an empty-state
   message ("No words found in this scroll.") rather than an error.
6. The frequency view SHALL be **derived only** — this increment persists no frequency data; it is
   recomputed from the scroll text on each load (the computation is pure and deterministic, like
   `parsePronouns`).

### Correctness Properties
- Property: `wordFrequency(text)` returns one entry per distinct non-filtered word with
  `count >= 1`, and with the stop-word filter off, `sum(counts)` equals the number of letter-run
  tokens in the text (after apostrophe splitting) — no occurrence double-counted or dropped.
- Property: `wordFrequency('')` returns an empty list and never throws.
- Property: the result ordering is total and deterministic (count desc, then word asc), so the same
  scroll text always renders the same order.

---

## Requirement 3: Record structural markers (transitional, direct-address, declarative)

### User Story
As a Bible student, I want to mark the transitional phrases, direct-address markers, and strong
declaratives I find, with where they occur, so that I can use them to see the book's structure.

### Acceptance Criteria
1. The system SHALL let the student record a **marker** with: a `kind` from a fixed set
   (`transition`, `direct-address`, `declarative`, `command`, `other`), the `phrase` text
   (required), an optional location reference (free text, e.g. a chapter:verse the student types or
   a character offset the tool fills from a suggestion), and optional `notes`.
2. The system SHALL surface **suggested candidate markers** by matching a small, client-owned
   signal-phrase list (drawn from the Step 7 reference: transitional phrases such as "now
   concerning", "finally", "therefore"; direct address such as "my brethren") against the scroll
   text, each candidate showing its matched phrase and location; the student MAY accept a candidate
   (which creates a marker) or ignore it. Suggestions SHALL be advisory only — an un-accepted
   candidate is **not** a saved marker.
3. The student SHALL be able to add a marker that is not in the suggestion list (free-text phrase +
   kind), and SHALL be able to edit and remove any marker before/after saving.
4. Matching for suggestions SHALL be case-insensitive and SHALL NOT interpret the scroll text as
   markup (HTML-significant characters are shown literally), consistent with the pronoun highlight's
   escaping rule.
5. WHEN the signal-phrase list matches nothing in the text THEN the system SHALL show an empty
   suggestions state and still allow the student to add markers manually (no error).

---

## Requirement 4: Capture genre and tone

### User Story
As a Bible student, I want to record the book's genre and overall tone, so that my structural
analysis names the kind of literature I am reading.

### Acceptance Criteria
1. The system SHALL provide a `genre` capture (a free-text field, optionally with a suggested list
   of common biblical genres — historical narrative, letter/epistle, poetry, prophecy, apocalyptic,
   wisdom, law — the student may pick from or type past), stored as free text.
2. The system SHALL provide a free-text `tone` field (multi-line, optional, bounded length).
3. Both fields SHALL be optional; an empty value SHALL be stored as `""` and SHALL NOT block
   saving the Structure Study.

---

## Requirement 5: Record the book's sections / divisions

### User Story
As a Bible student, I want to record the sections I divide the book into, so that I can see its
structure and feed a provisional outline in Step 8.

### Acceptance Criteria
1. The system SHALL let the student add an ordered list of **sections**, each with: a `label`
   (required free text, e.g. "Opening greeting", "Thanksgiving", "Body"), an optional `startRef`
   and `endRef` (free text the student types, e.g. "1:1", "1:1–2:4"), and optional `notes`.
2. The student SHALL be able to reorder, edit, and remove sections; the order SHALL be preserved as
   saved (the sections are the student's reading order through the book).
3. The sections surface SHALL carry a one-line reminder that chapter/verse/paragraph divisions are
   uninspired and should be verified, not trusted (Step 7 reference; assumption A5).
4. Sections SHALL be optional to start (an empty list is valid) but SHALL be the field a later
   Step 8 (Provisional Outline) tool consumes; the data model SHALL therefore store sections as an
   ordered, re-openable list (Requirement 7).

---

## Requirement 6: Optional elements chart

### User Story
As a Bible student, I want to optionally chart which structural elements occur in which sections,
so that I can compare the book against similar books.

### Acceptance Criteria
1. The system SHALL optionally let the student author an **elements chart**: a list of named
   `elements` (student free text, e.g. "greeting", "doxology", "command") and, for each element, the
   sections or references where it occurs.
2. The elements chart SHALL be entirely optional; a Structure Study with no elements chart SHALL be
   valid and SHALL save without it.
3. The elements chart SHALL reference the student's own sections (Requirement 5) by their position
   or label, so it stays consistent with the sections list; removing a section SHALL NOT corrupt
   the stored chart (a reference to a removed section is tolerated and surfaced as empty, not an
   error).

---

## Requirement 7: Persist and resume a Structure Study

### User Story
As a Bible student, I want my Structure Study saved so I can close the app and return to it later,
and so Step 8 can build on it.

### Acceptance Criteria
1. The system SHALL persist a Structure Study scoped to one `scrollStudyId` and one authenticated
   user, with fields: `scrollStudyId`, `userId` (from the Cognito `sub` claim), `genre`, `tone`,
   `markers` (list), `sections` (ordered list), `elements` (optional chart), `createdAt`, and
   `updatedAt` (ISO 8601).
2. The "Save" action SHALL `PUT`/`POST` the Structure Study and, on success, reflect the saved
   state (timestamps updated); a student MAY save repeatedly as they refine the analysis.
3. WHEN the student reopens the view for a scroll with a saved Structure Study THEN the system SHALL
   `GET` and render exactly the saved `genre`, `tone`, `markers`, `sections`, and `elements`.
4. The server SHALL set `userId` from the Cognito `sub` claim and SHALL ignore any `userId` in the
   request body (same hardening as `study-crud` / the antecedent CRUD).
5. There SHALL be at most one Structure Study per `(scrollStudyId, userId)` pair; saving again
   updates the same record (upsert), mirroring the one-record-per-scroll shape of `AntecedentStudy`.
6. IF a save fails THEN the system SHALL keep the student's entered values and show an inline error
   with a retry affordance; IF a load fails on a transient/5xx error THEN the system SHALL show a
   recoverable error state with a Retry button, distinct from the terminal `404` not-found state.

---

## Requirement 8: Set up the hand-off to Step 8 (Provisional Outline)

### User Story
As a Bible student, I want my sections to be usable by the later outlining step, so that Step 7
feeds Step 8 without re-entering my work.

### Acceptance Criteria
1. The Structure Study data model SHALL store `sections` as an ordered list of structured records
   (label + optional refs + notes) rather than as one free-text blob, so a later Step 8 tool can
   consume the paragraph/section list directly without parsing prose.
2. This increment SHALL NOT implement Step 8 outlining (bracketing/grouping sections into outline
   form) — only shape the sections so a later tool can build on them (Out of Scope).
3. Adding a Step 8 consumer later SHALL be achievable without a breaking migration of the Structure
   Study record (the `sections` shape is additive-friendly, like the `AntecedentStudy.assignments`
   and `BookStudy.referents` precedents).

---

## Non-Functional Requirements

1. **Stack conformance.** Frontend changes SHALL use Angular 21 standalone components with signals
   and Bulma styling, consistent with existing components (`pronoun-view`, `antecedent-view`).
   Backend changes SHALL be serverless (Lambda + API Gateway + DynamoDB) via CDK, consistent with
   the existing stack and mirroring the antecedent-study CRUD path.
2. **Auth and scoping.** All Structure Study routes SHALL require the Cognito authorizer and SHALL
   derive `userId` from the token's `sub` claim, never from client input. The frequency derivation
   runs in the browser over the already-fetched scroll text.
3. **No copyrighted-text policy unchanged.** The analyzed text is the student's own uploaded scroll,
   already persisted and user-scoped; this feature serves no app-provided Bible text and places
   nothing into any AI prompt. The frequency view and signal-phrase suggestions are computed
   client-side over the student's own text.
4. **CORS and throttling.** New routes SHALL inherit the API's existing CORS allow-list and
   usage-plan throttling; no new always-on resources SHALL be introduced.
5. **Cost.** Persistence SHALL reuse DynamoDB on-demand billing; the new table and single CRUD
   Lambda add negligible cost under the dev/prod cost model (consistent with the antecedent and
   book-study tables). No AWS endpoint is called from tests and no Bedrock call is added.
6. **Accessibility.** New UI SHALL be keyboard operable and screen-reader labeled, matching the
   ARIA patterns already used (`aria-label`, `aria-live`, `aria-pressed`, `role="alertdialog"` for
   any destructive confirm, `is-sr-only`).
7. **Determinism / performance.** The frequency derivation SHALL be a single O(n) pass over the
   scroll text (capped at ~350 KB by the scroll-text spec), completing synchronously without
   perceptibly blocking the UI — the same bound the pronoun parse meets.

---

## Out of Scope

- **Step 8 outlining itself** (bracketing/grouping sections into outline form) — a separate later
  tool that builds on this one; this increment only shapes the sections for it (Requirement 8).
- **Automatic/AI determination of the book's structure, genre, thesis, or theme** — the tool
  surfaces candidates and counts; the student makes every structural call.
- **Grammatical/NLP parsing, lemmatization, or sense disambiguation** of the scroll text; the
  frequency view and signal matching are plain token/phrase matching only.
- **A Bible concordance or any app-provided Bible text** — the frequency view is over the student's
  own uploaded scroll; no new source of text is introduced.
- **Any change to the Step 4 Scroll Study upload/extraction flow, the Step 5 Word Study, or the
  Step 6 Pronoun/Antecedent tools.**
- **Non-English scroll text** — the stop-word and signal-phrase lists are English (including the
  archaic KJV forms the Step 7 reference lists); unmatched forms simply do not appear.
- **Cross-navigation from a frequency/marker entry to each in-text occurrence** beyond showing a
  location (jump-to-occurrence is a later refinement, as it is for the pronoun highlight).
- **A top-level "Structure Studies" navbar surface** — the view is reached contextually from a
  specific `ready` scroll, matching how the pronoun and antecedent views are reached; a top-level
  surface can be added later if the step grows its own cross-book listing.
