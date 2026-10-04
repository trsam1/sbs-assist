# Requirements: Pronoun Type Classifier (Step 6 — Identify Antecedents, Referents, Audience, and Speaker)

## Context and assumptions

Issue #31 asks the app to let a student **classify the grammatical type of each pronoun**, with two
acceptance checks: a type for each individual pronoun that is selectable from a **fixed list**, and
an **optional hint** that explains the different types. The issue's Area is `frontend` and its risk
boxes (data tables / user pool / DNS / prod config, and "needs a design decision") are **unchecked**.

This feature is the next slice of the planned **Step 6 — Pronoun Study** tool
(`docs/references/inductive-study-step-6.md`). It builds directly on the shipped **Antecedent
Analysis** feature (`.kiro/specs/antecedent-analysis/`, implemented on `main`): that feature derives
a per-occurrence pronoun worklist from a `ready` Scroll Study, lets a student assign an antecedent to
each pronoun **occurrence**, and persists the set as an **Antecedent Study**
(`AntecedentAssignment` = `{ occurrence, start, word, antecedent }`, stored one record per scroll per
user in the `AntecedentStudies` DynamoDB table, served by the `antecedent-study` CRUD Lambda behind
the existing Cognito-authorized API Gateway). This feature **adds a grammatical `pronounType` to each
occurrence** — nothing else about the worklist, suggestion, save, or resume flow changes.

The classified thing is the **pronoun**, not the antecedent. The Step 6 reference defines, under the
heading **"Types of Pronouns,"** exactly **nine** grammatical pronoun types — Personal,
Demonstrative, Indefinite, Intensive, Reflexive, Interrogative, Relative, Reciprocal, Quantifier —
each with a Use description and Examples. That fixed, reference-defined list is what the student
chooses from. (This is the *grammatical type of the pronoun*; it is **not** a semantic classification
of what the antecedent refers to.)

The change is **additive to the existing persisted record**: a new optional `pronounType` field on
`AntecedentAssignment` (frontend `models.ts`, backend `shared/models.ts`), classified from the fixed
nine-type list in the `antecedent-view` worklist row, validated by the `antecedent-study` Lambda, and
stored in the same table item. No new DynamoDB table, Lambda, API route, CDK construct, or AWS
service is introduced; `infra/lib/stage-config.ts` is untouched. The issue's unchecked "touches data
tables / infra" box is correct: the table and routes already exist and this adds a field to the item
they already store.

Assumptions (flagged for the design review; each is the lowest-risk reading of the issue):

- **A1 — "the type of each pronoun" = a single grammatical type chosen per pronoun occurrence row.**
  It is attached to the same per-occurrence `AntecedentAssignment` row the Antecedent Analysis
  feature already keys per occurrence, because the pronoun is the per-occurrence worklist row that
  feature already produces. (Two occurrences of the same pronoun word are classified independently,
  consistent with the per-occurrence granularity the maintainer chose on PR #28 for the base
  feature.)
- **A2 — the "fixed list" is the nine grammatical pronoun types defined in the Step 6 reference's
  "Types of Pronouns" table, declared once in the frontend**, in the reference's order: **Personal,
  Demonstrative, Indefinite, Intensive, Reflexive, Interrogative, Relative, Reciprocal, Quantifier**.
  This is a fixed, closed, code-defined set; the acceptance criteria below are written to hold for
  that nine-member list, defined in one place and ordered deterministically to match the reference.
- **A3 — "optional hint" = an in-page explanation of what each pronoun type means, available on
  demand** (e.g. a disclosable help panel), not a required step and not a modal the student must
  dismiss. It is informational only; it never blocks classification. Each type's explanation is drawn
  from the Step 6 reference's own Use description and Examples for that type, so it carries no
  copyrighted Bible verse text.
- **A4 — classifying a type is optional per row, and does NOT require an antecedent.** A pronoun has
  a grammatical type regardless of whether the student has figured out its antecedent, so the type
  control is enabled for every pronoun occurrence row independently of whether that row's antecedent
  is filled in. A student may set a type with no antecedent, an antecedent with no type, both, or
  neither. (This differs from an earlier draft of this spec, which incorrectly gated the
  classification on a non-empty antecedent.)

---

## Requirement 1: Classify each pronoun's grammatical type from a fixed list

### User Story
As a Bible student, I want to classify each pronoun by its grammatical type (for example personal,
relative, or interrogative), so that I can see at a glance what kinds of pronouns the author uses and
reason about them more carefully.

### Acceptance Criteria
1. For each pronoun occurrence row in the antecedent worksheet, the worksheet SHALL present a type
   control whose options are exactly the fixed, code-defined nine-type list (Assumption A2) plus an
   explicit unclassified choice; the student SHALL be able to select one type for that row.
2. The type options SHALL come from a **single, closed, code-defined list** (one declaration in the
   frontend), presented in the Step 6 reference's **deterministic order** (Personal, Demonstrative,
   Indefinite, Intensive, Reflexive, Interrogative, Relative, Reciprocal, Quantifier); the set of
   selectable types SHALL NOT be user-editable.
3. The student SHALL be able to set a row's type back to **unclassified** (the empty / none choice),
   and a row with no chosen type SHALL render as unclassified rather than defaulting to a substantive
   type.
4. Setting a type on one occurrence row SHALL NOT change the type of any other row, including another
   occurrence of the same pronoun word.
5. The type control SHALL be enabled for every pronoun occurrence row **independently of that row's
   antecedent**: a student SHALL be able to choose a type for a row whose antecedent is empty, and
   clearing or editing the antecedent SHALL NOT change the row's chosen type (a pronoun's grammatical
   type does not depend on its antecedent — Assumption A4).
6. The type control SHALL be keyboard operable and screen-reader labeled, matching the ARIA patterns
   the app already uses (`aria-label`, Bulma `select`/control styling), and its label SHALL identify
   which pronoun occurrence it is for (the row's word plus position/snippet already shown by the base
   feature).

### Correctness Properties
- Property: For any row, the set of type values the control offers equals the fixed nine-type list
  plus the single unclassified choice — never more, never fewer, and never a user-added type.
- Property: After setting type `T` on occurrence row `o`, reading row `o`'s type returns `T`; setting
  `T` on `o` leaves every other row's type unchanged; and changing or clearing row `o`'s antecedent
  leaves row `o`'s type equal to `T`.

---

## Requirement 2: Optional hint explaining the pronoun types

### User Story
As a Bible student who is new to the inductive method, I want an optional explanation of what each
pronoun type means, so that I can classify correctly without leaving the worksheet.

### Acceptance Criteria
1. The worksheet SHALL offer an **optional** hint that explains the fixed nine-type list — what each
   type is used for and example words, drawn from the Step 6 reference's "Types of Pronouns" table
   (Use description and Examples), per Assumption A3.
2. The hint SHALL be available on demand and SHALL NOT be required to classify: the type control is
   fully usable whether or not the hint is shown, and nothing forces the student to open or dismiss it
   before working.
3. The hint SHALL cover **every** type in the fixed list (one explanation per type) so the help and
   the options never drift out of sync; the explanations SHALL be sourced from the same single
   pronoun-type definition the options come from (Requirement 1 criterion 2) rather than a separate
   hard-coded copy.
4. The hint content SHALL contain no copyrighted Bible verse text — only type names, short
   plain-language Use descriptions, and the reference's example pronoun words (e.g. "this, that,
   these, those" for Demonstrative), which are not verse quotations.
5. The hint control SHALL be keyboard operable and screen-reader labeled (e.g. a disclosable panel
   with `aria-expanded`/`aria-controls` or equivalent), consistent with the app's existing ARIA
   usage.

### Correctness Properties
- Property: The hint lists exactly one explanation for each type in the fixed nine-type list and no
  explanation for a type not in the list — the hint's keys equal the fixed pronoun-type set.

---

## Requirement 3: Persist and resume pronoun types

### User Story
As a Bible student, I want the type I chose for each pronoun to be saved and restored when I reopen
the worksheet, so that my classification work is not lost between sittings.

### Acceptance Criteria
1. WHEN the student saves the antecedent worksheet THEN each persisted assignment SHALL carry its
   chosen `pronounType` as a new field on the existing `AntecedentAssignment`, alongside the current
   `occurrence`, `start`, `word`, and `antecedent`.
2. A row that has a chosen `pronounType` but **no** antecedent SHALL be persisted (so the type is not
   lost), and a row with neither an antecedent nor a type SHALL continue to be dropped as before. The
   `pronounType` field SHALL be **optional/additive**: a persisted assignment with no chosen type
   SHALL store the type omitted or set to the explicit unclassified value and SHALL remain a valid
   record. This change SHALL NOT alter the base feature's createdAt-preserving, updatedAt-advancing,
   idempotent upsert semantics.
3. WHEN the student reopens the worksheet for the same `scrollStudyId` THEN every saved type SHALL be
   restored to its matching occurrence row (matched by `occurrence`, as the base feature matches
   antecedents), and an assignment saved without a type SHALL render as unclassified.
4. A saved `pronounType` value that is **not** a member of the current fixed nine-type list (e.g. a
   legacy or hand-edited record) SHALL be treated as unclassified on load rather than causing an
   error, so the worksheet never breaks on an unexpected stored value.
5. **Legacy tolerance.** An existing `AntecedentStudy` saved before this feature (whose assignments
   have no `pronounType` field) SHALL load without error, every such assignment rendering as
   unclassified; re-saving the worksheet SHALL write the `pronounType` field going forward.

### Correctness Properties
- Property: For any set of occurrence→(antecedent, pronounType) selections, `save` followed by a load
  for the same `scrollStudyId` returns, for each persisted occurrence, the same `antecedent` and the
  same `pronounType` (with unclassified round-tripping to unclassified). A row with neither an
  antecedent nor a type is dropped on save; a row with a type but no antecedent is kept.
- Property: Loading a record whose stored `pronounType` is absent, empty, or not in the current fixed
  list yields an unclassified row and never throws.

---

## Requirement 4: Server validation of the pronoun-type field

### User Story
As the system operator, I want the Antecedent Study API to validate the pronoun type it stores, so
that only a known type (or none) is ever persisted and a malformed client cannot write arbitrary
data.

### Acceptance Criteria
1. The `antecedent-study` Lambda's PUT body validation SHALL accept an optional `pronounType` on each
   assignment: a missing or empty `pronounType` SHALL be stored as the unclassified value (or
   omitted), and SHALL NOT be an error.
2. WHEN a provided `pronounType` is present but is **not** a member of the fixed nine-type list THEN
   the server SHALL reject the request with HTTP 400 (consistent with how the Lambda already rejects
   an over-length antecedent), rather than truncating, coercing, or silently storing it.
3. The fixed type list the server validates against SHALL be the **same** closed set the frontend
   offers (one shared definition of the allowed type values, so client and server cannot disagree on
   membership). This SHALL be enforced without introducing a new AWS service or route — it extends the
   existing PUT handler's validation only.
4. The server SHALL keep a row that has a valid `pronounType` but an empty antecedent (so a type-only
   classification persists), while continuing to drop a row that has neither an antecedent nor a type.
   All other existing PUT validation behavior (occurrence/start non-negative integers, non-empty
   `word`, antecedent trimmed and ≤200 chars) SHALL be preserved unchanged.

### Correctness Properties
- Property: For any assignment whose `pronounType` is absent, empty, or a member of the fixed list,
  the PUT handler accepts it and the stored assignment's `pronounType` is either the unclassified
  value or that member. For any assignment whose non-empty `pronounType` is not a member of the fixed
  list, the handler returns 400 and stores nothing.
- Property: A row with a valid `pronounType` and an empty antecedent is stored; a row with an empty
  antecedent and no `pronounType` is dropped.

---

## Non-Functional Requirements

1. **Additive, serverless-first, no new surface.** The feature adds a field to the existing
   `AntecedentAssignment` record and extends existing frontend/Lambda code only. It introduces **no**
   new DynamoDB table, Lambda, API route, CDK construct, CDK context lookup, un-hashed `public/`
   asset, or AWS service type, and makes **no** change to `infra/lib/stage-config.ts`. The existing
   `AntecedentStudies` table stores the enlarged item unchanged (schemaless attributes).
2. **Single source of truth for pronoun types.** The type list, its display order, its hint text, and
   the allowed values the server validates SHALL derive from one shared definition so the worklist
   control, the hint, and the server validation can never drift apart.
3. **No copyrighted Bible text.** Type names, hints, and example words contain no verse quotations;
   all student-visible text remains derived from the Step 6 reference's "Types of Pronouns" table and
   the student's own entries (consistent with the product's copyright constraint).
4. **Auth and scoping unchanged.** Type data rides on the same user-scoped (`Cognito sub`) Antecedent
   Study record; a student reads and writes only their own, enforced by the existing Lambda exactly as
   today.
5. **Accessibility.** The type control and the hint SHALL be keyboard operable and screen-reader
   labeled, matching the app's existing ARIA patterns.
6. **Determinism.** The type list order and the hint ordering SHALL be deterministic (stable across
   renders and sessions) and SHALL match the Step 6 reference's order.

---

## Out of Scope

- The antecedent assignment itself — the worklist, suggestion source, per-occurrence selection, save,
  and resume (the shipped Antecedent Analysis feature, `.kiro/specs/antecedent-analysis/`); this
  feature only adds a pronoun type to each occurrence row.
- The pronoun list and its parsing/highlighting (issue #20, Parse Scroll for Pronouns) — consumed, not
  changed.
- **Referent**, **audience**, **speaker**, and **point-of-view** identification — the other parts of
  Step 6; this increment adds pronoun types only.
- Classifying a pronoun's **person / gender / number / case**, or classifying the **antecedent** by
  what it refers to, or validating that a chosen type is grammatically correct for a given pronoun
  (the student classifies freely from the list; the app does not judge correctness).
- A user-editable or free-text type set — the type list is a fixed, code-defined, closed list of the
  nine reference types.
- Any new DynamoDB table, GSI, Lambda, API route, or AWS service; any change to the Scroll Study
  upload/extraction flow, the Word Study tool, or the Book Study tool.
- Aggregation, filtering, reporting, or export of pronouns by type (e.g. "show me every relative
  pronoun") — deferred to a later increment.
