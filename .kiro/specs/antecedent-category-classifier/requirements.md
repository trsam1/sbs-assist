# Requirements: Antecedent Category Classifier (Step 6 — Identify Antecedents, Referents, Audience, and Speaker)

## Context and assumptions

Issue #31 asks the app to let a student **classify the category of each antecedent**, with two
acceptance checks: a category for each individual antecedent that is selectable from a **fixed
list**, and an **optional hint** that explains the different types. The issue's Area is `frontend`
and its risk boxes (data tables / user pool / DNS / prod config, and "needs a design decision") are
**unchecked**.

This feature is the next slice of the planned **Step 6 — Pronoun Study** tool
(`docs/references/inductive-study-step-6.md`). It builds directly on the shipped **Antecedent
Analysis** feature (`.kiro/specs/antecedent-analysis/`, implemented on `main`): that feature lets a
student assign an antecedent to each pronoun **occurrence** in a `ready` Scroll Study and persist it
as an **Antecedent Study** (`AntecedentAssignment` = `{ occurrence, start, word, antecedent }`,
stored one record per scroll per user in the `AntecedentStudies` DynamoDB table, served by the
`antecedent-study` CRUD Lambda behind the existing Cognito-authorized API Gateway). This feature
**adds a `category` to each assignment** — nothing else about the worklist, suggestion, save, or
resume flow changes.

The change is **additive to the existing persisted record**: a new optional `category` field on
`AntecedentAssignment` (frontend `models.ts`, backend `shared/models.ts`), classified from a fixed
list in the `antecedent-view` worklist row, validated by the `antecedent-study` Lambda, and stored
in the same table item. No new DynamoDB table, Lambda, API route, CDK construct, or AWS service is
introduced; `infra/lib/stage-config.ts` is untouched. The issue's unchecked "touches data tables /
infra" box is correct: the table and routes already exist and this adds a field to the item they
already store.

Assumptions (flagged for the design review; each is the lowest-risk reading of the issue):

- **A1 — "the category of the antecedent" = a single classification chosen per antecedent
  assignment, i.e. per pronoun occurrence row.** It is attached to the same per-occurrence
  `AntecedentAssignment` the Antecedent Analysis feature already persists, not to the distinct
  antecedent *term* and not to the pronoun. (Two occurrences that share the same antecedent text are
  classified independently, consistent with the per-occurrence granularity the maintainer chose on
  PR #28 for the base feature.)
- **A2 — the "fixed list" is a small, closed, code-defined set of antecedent categories derived
  from the Step 6 reference's worked examples, declared once in the frontend** (see the proposed
  members below). The reference's Colossians 2:13-15 annotation distinguishes **Persons of the
  Trinity** (Father, Son/Jesus, Spirit) from **human persons/people** (the Colossians, Paul) and
  from **things** (the certificate of debt, the rulers and authorities), and the John 12 example
  adds a **place/world** sense; the proposed list captures those kinds. The exact membership is a
  design detail chosen in `design.md` and surfaced to the maintainer in the spec PR for
  confirmation; the acceptance criteria below are written to hold for **whatever** closed list the
  design fixes, provided it is defined in one place and ordered deterministically. The proposed
  members are: **Deity (Person of the Trinity)**, **Person / People**, **Group / Nation**,
  **Thing / Object**, **Place**, and **Other / Unknown**.
- **A3 — "optional hint" = an in-page explanation of what the categories mean, available on demand
  (e.g. a disclosable help panel or per-option tooltip text), not a required step and not a modal
  the student must dismiss.** It is informational only; it never blocks classification and carries
  no copyrighted Bible text (its example phrasing is drawn from the Step 6 reference the maintainer
  authors).
- **A4 — classifying a category is optional per row.** A student may assign an antecedent without a
  category (an "unclassified" antecedent is valid and persists as before), and clearing an
  antecedent clears its category. The category only has meaning for a row that has a non-empty
  antecedent.

---

## Requirement 1: Classify each antecedent's category from a fixed list

### User Story
As a Bible student, I want to classify each antecedent I have assigned by its category (for example
a Person of the Trinity, a human person, or a thing), so that I can see at a glance what kinds of
referents the pronouns in the book point to.

### Acceptance Criteria
1. For each pronoun occurrence row that has a non-empty antecedent, the antecedent worksheet SHALL
   present a category control whose options are exactly the fixed, code-defined category list
   (Assumption A2) plus an explicit unclassified choice; the student SHALL be able to select one
   category for that row.
2. The category options SHALL come from a **single, closed, code-defined list** (one declaration in
   the frontend), presented in a **deterministic order**; the set of selectable categories SHALL NOT
   be user-editable (unlike the free-text antecedent itself).
3. The student SHALL be able to set a row's category back to **unclassified** (the empty / none
   choice), and a row with an antecedent but no chosen category SHALL render as unclassified rather
   than defaulting to a substantive category.
4. Setting a category on one occurrence row SHALL NOT change the category of any other row, including
   another occurrence that happens to share the same antecedent text.
5. WHEN a row's antecedent is cleared (set back to empty, per the base feature's clear behavior) THEN
   that row's category SHALL also be cleared to unclassified, so a category is never persisted for an
   occurrence with no antecedent.
6. The category control SHALL be keyboard operable and screen-reader labeled, matching the ARIA
   patterns the app already uses (`aria-label`, Bulma `select`/control styling), and its label SHALL
   identify which pronoun occurrence it is for (the row's word plus position/snippet already shown by
   the base feature).

### Correctness Properties
- Property: For any row, the set of category values the control offers equals the fixed list plus the
  single unclassified choice — never more, never fewer, and never a user-added category.
- Property: After setting category `C` on occurrence row `o`, reading row `o`'s category returns `C`;
  after clearing row `o`'s antecedent, reading row `o`'s category returns the unclassified value.
  Setting `C` on `o` leaves every other row's category unchanged.

---

## Requirement 2: Optional hint explaining the category types

### User Story
As a Bible student who is new to the inductive method, I want an optional explanation of what each
antecedent category means, so that I can classify correctly without leaving the worksheet.

### Acceptance Criteria
1. The worksheet SHALL offer an **optional** hint that explains the fixed category list — what each
   category means with a short example drawn from the Step 6 reference (Assumption A3).
2. The hint SHALL be available on demand and SHALL NOT be required to classify: the category control
   is fully usable whether or not the hint is shown, and nothing forces the student to open or dismiss
   it before working.
3. The hint SHALL cover **every** category in the fixed list (one explanation per category) so the
   help and the options never drift out of sync; the explanations SHALL be sourced from the same
   single category definition the options come from (Requirement 1 criterion 2) rather than a separate
   hard-coded copy.
4. The hint content SHALL contain no copyrighted Bible verse text — only category names, short
   plain-language descriptions, and reference-sourced example terms (e.g. "Father", "the certificate
   of debt") that are not verse quotations.
5. The hint control SHALL be keyboard operable and screen-reader labeled (e.g. a disclosable panel
   with `aria-expanded`/`aria-controls` or equivalent), consistent with the app's existing ARIA
   usage.

### Correctness Properties
- Property: The hint lists exactly one explanation for each category in the fixed list and no
  explanation for a category not in the list — the hint's keys equal the fixed category set.

---

## Requirement 3: Persist and resume antecedent categories

### User Story
As a Bible student, I want the category I chose for each antecedent to be saved and restored when I
reopen the worksheet, so that my classification work is not lost between sittings.

### Acceptance Criteria
1. WHEN the student saves the antecedent worksheet THEN each persisted assignment (an occurrence with
   a non-empty antecedent) SHALL carry its chosen `category` as a new field on the existing
   `AntecedentAssignment`, alongside the current `occurrence`, `start`, `word`, and `antecedent`.
2. The `category` field SHALL be **optional/additive**: an assignment with no chosen category SHALL
   persist with the category omitted or set to the explicit unclassified value, and SHALL remain a
   valid record. This change SHALL NOT alter the save/resume semantics of the base Antecedent
   Analysis feature (createdAt preserved, updatedAt advanced, empties dropped, upsert idempotent).
3. WHEN the student reopens the worksheet for the same `scrollStudyId` THEN every saved category SHALL
   be restored to its matching occurrence row (matched by `occurrence`, as the base feature matches
   antecedents), and an assignment saved without a category SHALL render as unclassified.
4. A saved `category` value that is **not** a member of the current fixed list (e.g. a legacy or
   hand-edited record, or a list the maintainer later trims) SHALL be treated as unclassified on load
   rather than causing an error, so the worksheet never breaks on an unexpected stored value.
5. **Legacy tolerance.** An existing `AntecedentStudy` saved before this feature (whose assignments
   have no `category` field) SHALL load without error, every such assignment rendering as
   unclassified; re-saving the worksheet SHALL write the `category` field going forward.

### Correctness Properties
- Property: For any set of occurrence→(antecedent, category) selections, `save` followed by a load for
  the same `scrollStudyId` returns, for each non-empty-antecedent occurrence, the same `antecedent`
  and the same `category` (with unclassified round-tripping to unclassified). An assignment with no
  antecedent is still dropped on save (unchanged from the base feature).
- Property: Loading a record whose stored `category` is absent, empty, or not in the current fixed
  list yields an unclassified row and never throws.

---

## Requirement 4: Server validation of the category field

### User Story
As the system operator, I want the Antecedent Study API to validate the category it stores, so that
only a known category (or none) is ever persisted and a malformed client cannot write arbitrary data.

### Acceptance Criteria
1. The `antecedent-study` Lambda's PUT body validation SHALL accept an optional `category` on each
   assignment: a missing or empty `category` SHALL be stored as the unclassified value (or omitted),
   and SHALL NOT be an error.
2. WHEN a provided `category` is present but is **not** a member of the fixed category list THEN the
   server SHALL reject the request with HTTP 400 (consistent with how the Lambda already rejects an
   over-length antecedent), rather than truncating, coercing, or silently storing it.
3. The fixed category list the server validates against SHALL be the **same** closed set the frontend
   offers (one shared definition of the allowed category values, so client and server cannot disagree
   on membership). This SHALL be enforced without introducing a new AWS service or route — it extends
   the existing PUT handler's validation only.
4. All existing PUT validation behavior (occurrence/start non-negative integers, non-empty `word`,
   antecedent trimmed and ≤200 chars, empties dropped) SHALL be preserved unchanged.

### Correctness Properties
- Property: For any assignment whose `category` is absent, empty, or a member of the fixed list, the
  PUT handler accepts it and the stored assignment's `category` is either the unclassified value or
  that member. For any assignment whose non-empty `category` is not a member of the fixed list, the
  handler returns 400 and stores nothing.

---

## Non-Functional Requirements

1. **Additive, serverless-first, no new surface.** The feature adds a field to the existing
   `AntecedentAssignment` record and extends existing frontend/Lambda code only. It introduces **no**
   new DynamoDB table, Lambda, API route, CDK construct, CDK context lookup, un-hashed `public/`
   asset, or AWS service type, and makes **no** change to `infra/lib/stage-config.ts`. The existing
   `AntecedentStudies` table stores the enlarged item unchanged (schemaless attributes).
2. **Single source of truth for categories.** The category list, its display order, its hint text,
   and the allowed values the server validates SHALL derive from one shared definition so the
   worklist control, the hint, and the server validation can never drift apart.
3. **No copyrighted Bible text.** Categories, hints, and example terms contain no verse quotations;
   all student-visible text remains derived from the Step 6 reference and the student's own
   antecedent entries (consistent with the product's copyright constraint).
4. **Auth and scoping unchanged.** Category data rides on the same user-scoped (`Cognito sub`)
   Antecedent Study record; a student reads and writes only their own, enforced by the existing
   Lambda exactly as today.
5. **Accessibility.** The category control and the hint SHALL be keyboard operable and screen-reader
   labeled, matching the app's existing ARIA patterns.
6. **Determinism.** The category list order and the hint ordering SHALL be deterministic (stable
   across renders and sessions).

---

## Out of Scope

- The antecedent assignment itself — the worklist, suggestion source, per-occurrence selection, save,
  and resume (the shipped Antecedent Analysis feature, `.kiro/specs/antecedent-analysis/`); this
  feature only adds a category to each already-assigned antecedent.
- The pronoun list and its parsing/highlighting (issue #20, Parse Scroll for Pronouns) — consumed, not
  changed.
- **Referent**, **audience**, **speaker**, and **point-of-view** identification — the other parts of
  Step 6; this increment adds antecedent categories only.
- Classifying the **pronoun** by type/person/gender/number/case, or validating that a chosen category
  is grammatically or theologically correct for a given antecedent (the student classifies freely from
  the list; the app does not judge correctness).
- A user-editable or free-text category set — the category list is a fixed, code-defined, closed list
  (an admin/maintainer-managed list is deferred).
- Any new DynamoDB table, GSI, Lambda, API route, or AWS service; any change to the Scroll Study
  upload/extraction flow, the Word Study tool, or the Book Study tool.
- Aggregation, filtering, reporting, or export of antecedents by category (e.g. "show me every
  antecedent classified as a Person of the Trinity") — deferred to a later increment.
