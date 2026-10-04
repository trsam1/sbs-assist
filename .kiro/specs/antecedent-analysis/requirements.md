# Requirements: Antecedent Analysis (Step 6 — Identify Antecedents, Referents, Audience, and Speaker)

## Context and assumptions

Issue #23 asks the app to **correlate each pronoun in the list to its antecedent**, with three
acceptance checks: a user-editable dropdown list of antecedents, an initial generated list of
suggested antecedents from the scroll, and the ability to select an antecedent for each pronoun in
the list for a given study. The explicit **Out of Scope** on the issue is "the list of pronouns
(different feature)" — that is issue #20, the shipped **Parse Scroll for Pronouns** increment
(`.kiro/specs/parse-scroll-for-pronouns/`, now implemented on `main` under `src/app/`), which parses
a `ready` **Scroll Study** (Step 4, `.kiro/specs/scroll-text-upload/`) into a deterministic list of
pronouns.

This feature is the next slice of the planned **Step 6 — Pronoun Study** tool
(`docs/references/inductive-study-step-6.md`). Where #20 only *locates* pronouns and persists
nothing (it is frontend-only and derives its list on demand), this feature does the first
*interpretive* move of Step 6: letting the student assign an antecedent to each pronoun and
**persist** that work so they can return to it. It therefore introduces the first persisted Step-6
record — an **Antecedent Study** scoped to one Scroll Study and one user.

The reference is clear that an antecedent is identified **per pronoun occurrence**: the same word
form ("He") can take different antecedents in different places (the Colossians 2:13-15 worked
example assigns "He" to the Father in several places and distinct antecedents to other pronouns).
The maintainer has **decided the worklist granularity is per-occurrence** (PR #28 review): every
individual appearance of a pronoun in the scroll text gets its own antecedent assignment, so two
separate "he"s can resolve to different antecedents.

Issue #20's shipped output, however, is a *distinct-word* list — `parsePronouns(text)` returns
`PronounCount[]` (`{ word, count }`) and `toHighlightSegments(text)` returns ordered segments but
neither exposes a per-occurrence **position** a caller can key on. Delivering per-occurrence
antecedents therefore requires an **additive change to #20's pronoun services** to expose each
occurrence's position (character offset and a stable occurrence index). That change is a stated
prerequisite of this build (see Requirement 0 and `design.md`); it is kept additive — the existing
`parsePronouns`/`toHighlightSegments`/`isPronoun` signatures and behavior are preserved, a new
occurrence-list accessor is added alongside them.

Assumptions (flagged for the design review; each is the lowest-risk reading of the issue):

- **A1 — "the list" = the per-occurrence pronoun worklist derived from a `ready` Scroll Study
  (issue #20, extended).** The study is identified by its existing `scrollStudyId`. The worklist
  unit is a single **pronoun occurrence** — one in-text appearance of a dictionary pronoun — carrying
  its canonical lower-cased `word`, its zero-based **character offset** (`start`) in `scrollText`,
  and a stable **occurrence index** (`occurrence`, the 0-based ordinal of that appearance within the
  text in reading order). This feature attaches at most one antecedent selection to each occurrence.
  The worklist is ordered deterministically in reading order (ascending `start`).
- **A2 — "for a given study" = per Scroll Study, per user.** Antecedent selections are saved
  against the `scrollStudyId` and the authenticated user, exactly as the other persisted entities
  (`WordStudies`, `ScrollStudies`, `BookStudies`) are user-scoped by Cognito `sub`. A student only
  ever sees and edits their own antecedent work.
- **A3 — "initial generated list of suggested antecedents from the scroll" = an initial list of
  candidate antecedent terms derived from the same scroll text, offered as dropdown options.** The
  scroll text is **student-provided** (typed/pasted by the student, not sourced from a copyrighted
  work — maintainer-confirmed on PR #28), so the "no copyrighted Bible text" product constraint does
  not forbid processing it, including sending it to an AI/AWS service. The *mechanism* that produces
  the suggestions (a deterministic client-side heuristic vs. an AI/AWS service such as Amazon Bedrock
  or Amazon Comprehend) is a design decision evaluated and recommended in `design.md`; these
  requirements are written so the acceptance criteria hold regardless of which mechanism is chosen —
  the suggestions are an ordered, de-duplicated option set, and the student is never limited to them.
- **A4 — "user-editable dropdown" = a combo control per pronoun occurrence whose options are the
  suggested antecedents plus any the student has added, and that also accepts a free-typed
  antecedent.** The student is never limited to the generated suggestions; they can type a new
  antecedent (e.g. "the certificate of debt", "rulers and authorities") and it becomes a reusable
  option within that study.

---

## Requirement 0: Expose per-occurrence pronoun positions from the #20 services (prerequisite)

### User Story
As the build agent for this feature, I need the pronoun services shipped by #20 to expose each
pronoun **occurrence** with a stable position, so that an antecedent can be assigned to an individual
appearance rather than to a distinct word.

### Acceptance Criteria
1. The #20 pronoun module (`src/app/pronoun-parse.ts`) SHALL expose a new pure, exported function
   that returns the **ordered list of pronoun occurrences** in a text — one entry per in-text
   appearance of a dictionary pronoun — each entry carrying the canonical lower-cased `word`, the
   original-cased matched token, the zero-based character `start` offset in the text, and a 0-based
   `occurrence` index (reading order). This change SHALL be **additive**: the existing
   `parsePronouns`, `toHighlightSegments`, and `isPronoun` exports SHALL retain their current
   signatures and behavior.
2. The new occurrence list SHALL be deterministic and pure (same input text → same ordered list),
   O(n) over the characters, never throw, and return `[]` for the empty string — the same contract
   the existing #20 functions hold.
3. The occurrence list SHALL use the **same** single pronoun dictionary and whole-letter-run matching
   rules as `parsePronouns`/`toHighlightSegments` (one pronoun definition in the code); the count of
   occurrences for a given `word` SHALL equal that word's `count` in `parsePronouns(text)` for the
   same text.

### Correctness Properties
- Property: For any text, grouping the new occurrence list by `word` and counting yields exactly
  `parsePronouns(text)` (same words, same counts) — the two views never disagree.
- Property: Occurrence `start` offsets are strictly increasing in `occurrence` order, and each
  `start` indexes the first character of a whole-letter-run that `isPronoun` accepts.

---

## Requirement 1: Open the antecedent worksheet for a ready scroll

### User Story
As a Bible student, I want to open an antecedent worksheet for a book whose scroll I have uploaded,
so that I can work through each pronoun occurrence and assign it an antecedent.

### Acceptance Criteria
1. WHEN the student opens the antecedent view for a Scroll Study whose status is `ready` THEN the
   system SHALL derive the per-occurrence pronoun worklist from that study's `scrollText` using the
   same pronoun dictionary and parse rules as the Parse Scroll for Pronouns feature (#20), via the
   per-occurrence accessor from Requirement 0, and SHALL display one row per pronoun **occurrence**
   in reading order.
2. WHEN a saved Antecedent Study already exists for that `scrollStudyId` THEN the system SHALL load
   the saved antecedent selections and pre-populate each matching occurrence row with its saved
   antecedent; an occurrence with no saved selection SHALL render with an empty selection.
3. WHEN the referenced Scroll Study status is `uploading` or `extracting` THEN the system SHALL show
   a non-blocking "the scroll text is still being prepared" message with a link back to the scroll
   view (`/scroll/:scrollStudyId`) and SHALL NOT derive a worklist or allow editing.
4. WHEN the referenced Scroll Study status is `failed`, or the study does not exist or is not owned
   by the user (API returns 404) THEN the system SHALL show an explanatory message with a link back
   to the scroll list (`/scrolls`) and SHALL NOT derive a worklist.
5. WHEN the scroll text contains no pronoun-dictionary words THEN the system SHALL show an
   empty-state message ("No pronouns found in this scroll.") and SHALL NOT offer a save action.
6. Each occurrence row SHALL give the student enough context to tell occurrences of the same word
   apart — at minimum the pronoun token shown in a short surrounding snippet of the scroll text (the
   row identifies the occurrence by its position, not merely by the bare word).

### Correctness Properties
- Property: For any `ready` scroll text, the set of occurrence rows rendered equals the ordered
  per-occurrence list the #20 accessor returns — the antecedent feature never adds, drops, or
  reorders an occurrence relative to #20's parse.
- Property: Loading a saved Antecedent Study and then rendering is idempotent — an occurrence with a
  saved antecedent always renders that antecedent, and one without renders empty, for any saved
  record.

---

## Requirement 2: Generate suggested antecedents from the scroll

### User Story
As a Bible student, I want the worksheet to suggest likely antecedents drawn from the book itself,
so that I can pick an antecedent quickly instead of typing every one by hand.

### Acceptance Criteria
1. WHEN the antecedent worksheet opens for a `ready` scroll THEN the system SHALL produce an initial
   list of suggested antecedents from the same `scrollText`. The suggestions are derived only from
   the student's own scroll text (and the student's previously-saved antecedents for this study); the
   feature serves no app-provided copyrighted Bible text.
2. The suggestion list SHALL be a set of distinct candidate antecedent terms, de-duplicated
   case-insensitively and presented in a deterministic order (alphabetically ascending), so the
   dropdown options for a given scroll are stable within a session.
3. The suggestion computation SHALL exclude the pronoun-dictionary words themselves (a pronoun is
   never offered as an antecedent of a pronoun).
4. WHEN the suggestion step yields no candidates (or, if an AI/AWS mechanism is used, is unavailable)
   THEN the dropdown SHALL still be usable with an empty suggestion set, relying on the free-text
   entry path (Requirement 3), and SHALL NOT error or block the student from working.

### Correctness Properties
- Property: The suggestion option set presented to the student contains no pronoun-dictionary word
  and no duplicate (case-insensitive), and is ordered ascending.
- Property: An empty or whitespace-only scroll text yields an empty suggestion set and never throws
  or blocks the worksheet.

---

## Requirement 3: Select or enter an antecedent per pronoun occurrence (user-editable dropdown)

### User Story
As a Bible student, I want to choose a suggested antecedent for each pronoun occurrence or type my
own, so that I can record exactly who or what each pronoun refers to at that point in the book.

### Acceptance Criteria
1. Each pronoun occurrence row SHALL present a user-editable dropdown (combo control) whose options
   are the suggested antecedents (Requirement 2) plus any antecedents the student has added within
   this study.
2. The student SHALL be able to select one antecedent from the options for an occurrence row.
3. The student SHALL be able to type a new antecedent not present in the options; on confirmation the
   typed value SHALL be set as that occurrence's antecedent AND SHALL be added to the shared option
   list so it is selectable for other occurrence rows in the same study.
4. The student SHALL be able to clear an occurrence's antecedent back to the empty (unassigned) state.
5. A typed antecedent SHALL be trimmed of leading/trailing whitespace; an all-whitespace entry SHALL
   be treated as clearing the selection (criterion 4), not as adding a blank option.
6. A typed antecedent SHALL be limited to a maximum length of 200 characters. The input control
   SHALL cap entry at 200 characters (`maxlength`) so over-length text cannot be typed, AND the
   server SHALL **reject** (HTTP 400) any assignment whose trimmed `antecedent` exceeds 200
   characters rather than truncating it, so the client and server agree on reject (never a silent
   truncation).
7. The dropdown SHALL be keyboard operable and screen-reader labeled, matching the ARIA patterns the
   app already uses (`aria-label`, Bulma `select`/control styling), and each row SHALL identify which
   pronoun occurrence its control is for (word plus position/snippet, Requirement 1 criterion 6).

### Correctness Properties
- Property: After selecting antecedent `A` for occurrence row `o`, reading row `o`'s antecedent
  returns the trimmed `A`; after clearing, it returns the empty string. Setting `A` on one occurrence
  of a word SHALL NOT change any other occurrence of the same word.
- Property: Adding a new typed antecedent `A` makes `A` present exactly once in the shared option
  list (case-insensitive de-duplication), regardless of how many rows subsequently use it.

---

## Requirement 4: Save and resume the antecedent study

### User Story
As a Bible student, I want to save the antecedents I have assigned and return to them later, so that
I can work through a book's pronoun occurrences across multiple sittings.

### Acceptance Criteria
1. The student SHALL be able to save the antecedent worksheet at any point; the save SHALL persist,
   for the given `scrollStudyId` and user, each pronoun **occurrence** that has a non-empty assigned
   antecedent together with that occurrence's identity (its `occurrence` index and `start` offset)
   and the antecedent value.
2. Saving SHALL create the Antecedent Study record on first save and update it on subsequent saves,
   preserving the original `createdAt` and updating `updatedAt`, mirroring the save semantics of the
   existing study records.
3. WHEN the student reopens the worksheet for the same scroll (Requirement 1 criterion 2) THEN every
   previously-assigned antecedent SHALL be restored to its matching occurrence row and every
   previously-typed antecedent SHALL be available in the dropdown options.
4. The save action SHALL report success or failure to the student; on failure the student's
   in-progress selections SHALL remain editable (the save is retryable) and SHALL NOT be silently
   discarded.
5. WHEN the student saves a worksheet in which every occurrence's antecedent is empty (none assigned,
   or all previously-assigned antecedents cleared) THEN the save SHALL upsert the Antecedent Study
   record with `assignments: []` idempotently — it SHALL NOT delete the record and SHALL NOT leave a
   stale prior set of assignments. (There is no delete action in this increment.)
6. A saved assignment whose occurrence is no longer found in the current scroll parse (e.g. the
   scroll was re-uploaded with different text, so that `occurrence`/`start` no longer resolves to a
   matching pronoun occurrence) SHALL be ignored on load rather than causing an error; only
   antecedents whose occurrence still appears in the current worklist are shown.

### Correctness Properties
- Property: For any set of occurrence→antecedent assignments, `save` followed by a load for the same
  `scrollStudyId` returns a record whose assignments equal the saved non-empty assignments (empty
  assignments are dropped); a save with zero non-empty assignments yields a loaded record with
  `assignments: []` (never a missing record and never the prior set).
- Property: On the first save a record is created with `createdAt == updatedAt == saveTime`; on
  every subsequent save of the same `scrollStudyId` the loaded record's `createdAt` equals the
  value from the first save (unchanged) while `updatedAt` equals the later save time.

---

## Non-Functional Requirements

1. **Serverless-first / least new surface.** Persistence reuses the existing project patterns: a
   single new DynamoDB table following the same single-table-per-entity, `USER#<sub>` /
   `<ENTITY>#<id>` key shape as `ScrollStudies`/`WordStudies`/`BookStudies`, served by a new CRUD
   Lambda behind the existing Cognito-authorized API Gateway. No new always-on resource, VPC, or new
   AWS service type is introduced for persistence. IF the suggestion mechanism chosen in `design.md`
   adds an AWS service (e.g. Amazon Bedrock or Amazon Comprehend), that is the only new AWS service
   type the feature introduces, it is pay-per-use/serverless, and the design flags that this feature
   is then no longer frontend-only (the issue's "touches data tables / infra" risk is reconsidered by
   the maintainer).
2. **Auth and scoping.** All antecedent records are scoped to the Cognito `sub` server-side; a
   student can read or write only their own Antecedent Study, enforced in the Lambda exactly as the
   other CRUD Lambdas enforce it (404 for a record the `sub` does not own).
3. **Copyright policy.** The worklist, suggestions, and saved antecedents are all derived from the
   student's **own** scroll text (student-typed/pasted, maintainer-confirmed not sourced from a
   copyrighted work) or typed directly by the student; this feature serves no app-provided
   copyrighted Bible text. Because the scroll text is the student's own content, processing it —
   including sending it to an AI/AWS suggestion service — does not violate the product's "AI prompts
   contain only Strong's data + student notes / no copyrighted Bible text" constraint.
4. **Cost.** The baseline new per-request cost is the Antecedent Study CRUD calls (on-demand
   DynamoDB, one small Lambda); pronoun parsing runs client-side over the already-fetched scroll
   text. IF `design.md` recommends an AI/AWS suggestion mechanism, its cost SHALL be pay-per-use and
   is weighed in the design evaluation against the stack's cost-conscious, serverless-first stance
   (Bedrock is the stack's main cost variable); the mechanism SHALL degrade gracefully to a usable
   worksheet if the service is unavailable (Requirement 2 criterion 4).
5. **Accessibility.** New UI SHALL be keyboard operable and screen-reader labeled, matching the ARIA
   patterns already used (`aria-label`, `aria-live`, Bulma components).
6. **Determinism / performance.** Per-occurrence worklist parsing SHALL be a single O(n) pass over
   the scroll text (capped at ~350 KB by the scroll-text spec), completing without perceptibly
   blocking the UI. A client-side suggestion heuristic SHALL likewise be O(n); an AI/AWS suggestion
   call SHALL be asynchronous and non-blocking (the worklist renders before suggestions arrive).
7. **CDK context / assets.** No new CDK context lookup and no new un-hashed `public/` asset are
   introduced, so `cdk.context.json` and the `DeployShell`/`DeployAssets` include/exclude lists are
   unchanged, regardless of the suggestion mechanism chosen.

---

## Out of Scope

- The pronoun list itself and its parsing/highlighting (issue #20, Parse Scroll for Pronouns) — this
  feature consumes that worklist (via the additive per-occurrence accessor of Requirement 0), it does
  not reimplement it.
- **Referent**, **audience**, **speaker**, and **point-of-view** identification — the other parts of
  Step 6 covered by the reference; this increment delivers antecedents only.
- Classifying pronouns by type/person/gender/number/case, or validating that a chosen antecedent is
  grammatically correct.
- Serving or displaying copyrighted Bible verse text alongside the pronouns.
- Any non-additive change to #20's existing `parsePronouns`/`toHighlightSegments`/`isPronoun`
  exports — Requirement 0 adds a new accessor alongside them and does not alter their behavior.
- A top-level "Antecedent Studies" list surface (records are reached via their scroll); the index/GSI
  such a surface would need is deferred.
- Any change to the Scroll Study upload/extraction flow, the Word Study tool, or the Book Study tool.
