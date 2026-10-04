# Requirements: Antecedent Analysis (Step 6 — Identify Antecedents, Referents, Audience, and Speaker)

## Context and assumptions

Issue #23 asks the app to **correlate each pronoun in the list to its antecedent**, with three
acceptance checks: a user-editable dropdown list of antecedents, an initial generated list of
suggested antecedents from the scroll, and the ability to select an antecedent for each pronoun in
the list for a given study. The explicit **Out of Scope** on the issue is "the list of pronouns
(different feature)" — that is issue #20, the shipped-as-spec **Parse Scroll for Pronouns**
increment (`.kiro/specs/parse-scroll-for-pronouns/`), which parses a `ready` **Scroll Study**
(Step 4, `.kiro/specs/scroll-text-upload/`) into a deterministic worklist of pronouns.

This feature is the next slice of the planned **Step 6 — Pronoun Study** tool
(`docs/references/inductive-study-step-6.md`). Where #20 only *locates* pronouns and persists
nothing (it is frontend-only and derives its list on demand), this feature does the first
*interpretive* move of Step 6: letting the student assign an antecedent to each pronoun and
**persist** that work so they can return to it. It therefore introduces the first persisted Step-6
record — an **Antecedent Study** scoped to one Scroll Study and one user.

The reference is clear that an antecedent is identified **per pronoun occurrence**: the same word
form ("He") can take different antecedents in different places (the Colossians 2:13-15 worked
example assigns "He" to the Father in several places and distinct antecedents to other pronouns).
Issue #20's output, however, is a *distinct-word* list (each pronoun word plus a count), not an
occurrence list. Reconciling these two shapes is the central design question (resolved in
`design.md`); the requirements below are written against the **worklist unit that #20 actually
produces and this feature consumes**, and name that unit explicitly so the acceptance criteria stay
testable regardless of how the worklist is later enriched.

Assumptions (flagged for the design review; each is the lowest-risk reading of the issue):

- **A1 — "the list" = the pronoun worklist derived from a `ready` Scroll Study (issue #20).** The
  study is identified by its existing `scrollStudyId`; the worklist unit is the distinct pronoun
  word that #20's `parsePronouns` returns (word + occurrence count), ordered deterministically the
  way #20 orders it. This feature attaches at most one antecedent selection to each worklist unit.
  (The design records how this extends if #20 is later changed to per-occurrence units.)
- **A2 — "for a given study" = per Scroll Study, per user.** Antecedent selections are saved
  against the `scrollStudyId` and the authenticated user, exactly as the other persisted entities
  (`WordStudies`, `ScrollStudies`, `BookStudies`) are user-scoped by Cognito `sub`. A student only
  ever sees and edits their own antecedent work.
- **A3 — "initial generated list of suggested antecedents from the scroll" = a deterministic,
  client-side extraction of candidate nouns/names from the same scroll text, offered as dropdown
  options.** No AI call and no new Bible text source: the suggestions are derived from the scroll
  text #20 already parses (capitalised words / proper-noun candidates), because the product forbids
  app-provided Bible text and the stack is serverless-first/cost-minimal. "Generated" here means
  computed from the scroll, not AI-generated.
- **A4 — "user-editable dropdown" = a combo control per pronoun whose options are the suggested
  antecedents plus any the student has added, and that also accepts a free-typed antecedent.** The
  student is never limited to the generated suggestions; they can type a new antecedent (e.g. "the
  certificate of debt", "rulers and authorities") and it becomes a reusable option within that
  study.

---

## Requirement 1: Open the antecedent worksheet for a ready scroll

### User Story
As a Bible student, I want to open an antecedent worksheet for a book whose scroll I have uploaded,
so that I can work through its pronouns and assign each one an antecedent.

### Acceptance Criteria
1. WHEN the student opens the antecedent view for a Scroll Study whose status is `ready` THEN the
   system SHALL derive the pronoun worklist from that study's `scrollText` using the same pronoun
   dictionary and parse rules as the Parse Scroll for Pronouns feature (#20), and SHALL display one
   row per worklist unit.
2. WHEN a saved Antecedent Study already exists for that `scrollStudyId` THEN the system SHALL load
   the saved antecedent selections and pre-populate each matching pronoun row with its saved
   antecedent; a worklist unit with no saved selection SHALL render with an empty selection.
3. WHEN the referenced Scroll Study status is `uploading` or `extracting` THEN the system SHALL show
   a non-blocking "the scroll text is still being prepared" message with a link back to the scroll
   view (`/scroll/:scrollStudyId`) and SHALL NOT derive a worklist or allow editing.
4. WHEN the referenced Scroll Study status is `failed`, or the study does not exist or is not owned
   by the user (API returns 404) THEN the system SHALL show an explanatory message with a link back
   to the scroll list (`/scrolls`) and SHALL NOT derive a worklist.
5. WHEN the scroll text contains no pronoun-dictionary words THEN the system SHALL show an
   empty-state message ("No pronouns found in this scroll.") and SHALL NOT offer a save action.

### Correctness Properties
- Property: For any `ready` scroll text, the set of pronoun rows rendered equals the set of distinct
  pronouns `parsePronouns(scrollText)` returns — the antecedent feature never adds or drops a
  worklist unit relative to #20's parse.
- Property: Loading a saved Antecedent Study and then rendering is idempotent — a worklist unit with
  a saved antecedent always renders that antecedent, and one without renders empty, for any saved
  record.

---

## Requirement 2: Generate suggested antecedents from the scroll

### User Story
As a Bible student, I want the worksheet to suggest likely antecedents drawn from the book itself,
so that I can pick an antecedent quickly instead of typing every one by hand.

### Acceptance Criteria
1. WHEN the antecedent worksheet opens for a `ready` scroll THEN the system SHALL compute an initial
   list of suggested antecedents deterministically from the same `scrollText`, with no AI call and
   no app-provided Bible text.
2. The suggestion list SHALL be the set of distinct candidate antecedent terms extracted from the
   scroll text (capitalised, non-sentence-initial-only proper-noun candidates and the student's own
   previously-saved antecedents for this study), de-duplicated case-insensitively and ordered
   deterministically (alphabetically ascending) so the same scroll always yields the same options.
3. The suggestion computation SHALL exclude the pronoun-dictionary words themselves (a pronoun is
   never offered as an antecedent of a pronoun).
4. WHEN the extraction yields no candidates THEN the dropdown SHALL still be usable with an empty
   suggestion set, relying on the free-text entry path (Requirement 3), and SHALL NOT error.

### Correctness Properties
- Property: `suggestAntecedents(text)` is pure and deterministic — for the same input text it
  returns the same ordered, de-duplicated list, and never includes a pronoun-dictionary word.
- Property: `suggestAntecedents('')` returns an empty list and never throws.

---

## Requirement 3: Select or enter an antecedent per pronoun (user-editable dropdown)

### User Story
As a Bible student, I want to choose a suggested antecedent for each pronoun or type my own, so that
I can record exactly who or what each pronoun refers to.

### Acceptance Criteria
1. Each pronoun row SHALL present a user-editable dropdown (combo control) whose options are the
   suggested antecedents (Requirement 2) plus any antecedents the student has added within this
   study.
2. The student SHALL be able to select one antecedent from the options for a pronoun row.
3. The student SHALL be able to type a new antecedent not present in the options; on confirmation the
   typed value SHALL be set as that pronoun's antecedent AND SHALL be added to the shared option list
   so it is selectable for other pronoun rows in the same study.
4. The student SHALL be able to clear a pronoun's antecedent back to the empty (unassigned) state.
5. A typed antecedent SHALL be trimmed of leading/trailing whitespace; an all-whitespace entry SHALL
   be treated as clearing the selection (criterion 4), not as adding a blank option.
6. A typed antecedent SHALL be limited to a maximum length of 200 characters. The input control
   SHALL cap entry at 200 characters (`maxlength`) so over-length text cannot be typed, AND the
   server SHALL **reject** (HTTP 400) any assignment whose trimmed `antecedent` exceeds 200
   characters rather than truncating it, so the client and server agree on reject (never a silent
   truncation).
7. The dropdown SHALL be keyboard operable and screen-reader labeled, matching the ARIA patterns the
   app already uses (`aria-label`, Bulma `select`/control styling), and each row SHALL identify which
   pronoun its control is for.

### Correctness Properties
- Property: After selecting antecedent `A` for pronoun row `p`, reading row `p`'s antecedent returns
  the trimmed `A`; after clearing, it returns the empty string.
- Property: Adding a new typed antecedent `A` makes `A` present exactly once in the shared option
  list (case-insensitive de-duplication), regardless of how many rows subsequently use it.

---

## Requirement 4: Save and resume the antecedent study

### User Story
As a Bible student, I want to save the antecedents I have assigned and return to them later, so that
I can work through a book's pronouns across multiple sittings.

### Acceptance Criteria
1. The student SHALL be able to save the antecedent worksheet at any point; the save SHALL persist,
   for the given `scrollStudyId` and user, each pronoun worklist unit that has a non-empty assigned
   antecedent together with that antecedent value.
2. Saving SHALL create the Antecedent Study record on first save and update it on subsequent saves,
   preserving the original `createdAt` and updating `updatedAt`, mirroring the save semantics of the
   existing study records.
3. WHEN the student reopens the worksheet for the same scroll (Requirement 1 criterion 2) THEN every
   previously-assigned antecedent SHALL be restored to its pronoun row and every previously-typed
   antecedent SHALL be available in the dropdown options.
4. The save action SHALL report success or failure to the student; on failure the student's
   in-progress selections SHALL remain editable (the save is retryable) and SHALL NOT be silently
   discarded.
5. WHEN the student saves a worksheet in which every pronoun's antecedent is empty (none assigned,
   or all previously-assigned antecedents cleared) THEN the save SHALL upsert the Antecedent Study
   record with `assignments: []` idempotently — it SHALL NOT delete the record and SHALL NOT leave a
   stale prior set of assignments. (There is no delete action in this increment.)
6. A pronoun worklist unit present in a saved record but no longer found in the current scroll parse
   (e.g. the scroll was re-uploaded with different text) SHALL be ignored on load rather than causing
   an error; only antecedents whose pronoun still appears in the worklist are shown.

### Correctness Properties
- Property: For any set of pronoun→antecedent assignments, `save` followed by a load for the same
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
   `<ENTITY>#<id>` key shape and `GSI1` (updated-at) layout as `ScrollStudies`/`WordStudies`/
   `BookStudies`, served by a new CRUD Lambda behind the existing Cognito-authorized API Gateway.
   No new always-on resource, VPC, or AWS service type is introduced.
2. **Auth and scoping.** All antecedent records are scoped to the Cognito `sub` server-side; a
   student can read or write only their own Antecedent Study, enforced in the Lambda exactly as the
   other CRUD Lambdas enforce it (404 for a record the `sub` does not own).
3. **No copyrighted-text policy unchanged.** The worklist, suggestions, and saved antecedents are all
   derived from the student's own uploaded scroll text (already persisted and user-scoped) or typed
   by the student; this feature serves no app-provided Bible text and places nothing into any AI
   prompt (there is no AI call in this feature).
4. **Cost.** The only new per-request cost is the Antecedent Study CRUD calls (on-demand DynamoDB,
   one small Lambda); pronoun parsing and suggestion extraction run client-side over the
   already-fetched scroll text. No Bedrock invocation is added.
5. **Accessibility.** New UI SHALL be keyboard operable and screen-reader labeled, matching the ARIA
   patterns already used (`aria-label`, `aria-live`, Bulma components).
6. **Determinism / performance.** Worklist parsing and suggestion extraction SHALL each be a single
   O(n) pass over the scroll text (capped at ~350 KB by the scroll-text spec), completing without
   perceptibly blocking the UI.
7. **CDK context / assets.** No new CDK context lookup and no new un-hashed `public/` asset are
   introduced, so `cdk.context.json` and the `DeployShell`/`DeployAssets` include/exclude lists are
   unchanged.

---

## Out of Scope

- The pronoun list itself and its parsing/highlighting (issue #20, Parse Scroll for Pronouns) — this
  feature consumes that worklist, it does not reimplement it.
- **Referent**, **audience**, **speaker**, and **point-of-view** identification — the other parts of
  Step 6 covered by the reference; this increment delivers antecedents only.
- AI-generated antecedent suggestions or any Bedrock/AI call (suggestions are deterministic,
  client-side extraction from the scroll text).
- Per-grammatical-occurrence antecedents keyed to a verse/offset position IF #20's worklist unit
  stays a distinct-word unit; the design notes how this feature extends to per-occurrence units
  without a data-model change if #20 later produces them, but adding occurrence positions to #20 is
  not in this scope.
- Classifying pronouns by type/person/gender/number/case, or validating that a chosen antecedent is
  grammatically correct.
- Serving or displaying copyrighted Bible verse text alongside the pronouns.
- Any change to the Scroll Study upload/extraction flow, the Word Study tool, or the Book Study tool.
