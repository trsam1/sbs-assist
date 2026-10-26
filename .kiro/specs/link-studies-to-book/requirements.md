# Requirements: Make the Book Study the container for all step work

## Context and Assumptions

Today the app has two parallel roots. A **Scroll Study** (`ScrollStudy`, keyed by its own
`scrollStudyId`) carries a free-text `bookName` and is the de-facto hub for the step work:
pronouns, antecedents, structure, and outline are all keyed by `scrollStudyId` and reached
from buttons inside the Scroll view (`/scroll/:scrollStudyId/...`). Separately a **Book
Study** (`BookStudy`, keyed by `bookStudyId`) is a near-empty container holding only the
book name, an optional title/notes, and — oddly — the Step 6 **Referents**. The result is
tool sprawl: the organizing object (Book) owns almost nothing, while the Scroll owns
everything, and the two are not linked at all.

The product intent is that **the Book is the grouping object**: under a Book a student
collects their step artifacts — the scroll, pronoun work, antecedents, structure, outline,
theme/purpose. The `organize-studies-by-book` spec explicitly reserved this increment:
"The Book Study data model SHALL be designed so a later increment can associate … a
`bookStudyId` reference … without a breaking migration." This spec is that increment, for
the Scroll and its downstream step work.

This spec **does not** touch the Word Study (`/studies`, the Step 5 per-word worksheet). It
is a deliberate outlier for now and keeps its own flow unchanged.

Assumptions (flagged for design review; each is the lowest-risk reading):

- **A1.** A Book Study has **exactly one** Scroll Study (the scroll *is* the book's text,
  and the method is book-by-book). The Book-detail page refers to "the scroll" in the
  singular; a Book may have **zero or one** scroll, never more. (User-confirmed.)
- **A2.** The link is modeled as a `bookStudyId` **attribute** on the `ScrollStudy` record
  — an additive, non-key field. The `ScrollStudies` table is not replaced and no key
  schema changes, so the stateful-resource guard stays green.
- **A3.** The downstream step records (antecedents, structure, outline) are **not** modified
  or re-keyed. They remain keyed by `scrollStudyId`; linking the Scroll to the Book brings
  them under the Book transitively, with no migration of those tables.
- **A4.** The canonical navigation becomes Book-centric: a Book Study detail page is the hub
  that shows the linked scroll's status and deep-links to each step. The existing
  `/scroll/:scrollStudyId/...` step routes are **kept** (the step views are unchanged); only
  the entry point moves to the Book-detail hub.
- **A5.** Referents (currently stored on the Book Study and edited on its detail page) are
  Step 6 work. They stay on the `BookStudy` record (no data move), but the Book-detail page
  stops being a referent-editing form and becomes the step hub; referent editing is surfaced
  from the Step 6 area of the hub. The stored referent shape is unchanged.
- **A6.** Existing data is backfilled by a one-time, idempotent migration that links each
  orphan Scroll Study to a Book Study, matching on `bookName`, creating a Book Study when
  none exists for that book. Running on dev only (prod has the maintainer's real data, so
  prod backfill is a separate, user-run step called out in the design).

---

## Requirement 1: Link a Scroll Study to a Book Study

### User Story
As a Bible student, I want each scroll to belong to the book study it is the text for, so
that all my work for that book lives under one container.

### Acceptance Criteria
1. The `ScrollStudy` record SHALL carry a `bookStudyId` (string) identifying the owning Book
   Study. It is an additive, non-key attribute; the `ScrollStudies` table key schema and
   GSI SHALL NOT change.
2. WHEN a scroll is created from within a Book Study THEN the system SHALL set its
   `bookStudyId` to that Book Study, and SHALL set `bookName` from the Book Study's `book`.
3. A Book Study SHALL have **at most one** Scroll Study. WHEN a scroll already exists for a
   Book Study AND the user attempts to create another THEN the system SHALL block the second
   creation (the UI offers to open or replace the existing scroll, not add a second).
4. The server SHALL derive ownership from the Cognito `sub` claim for both records and SHALL
   reject (`400`) a create whose `bookStudyId` does not resolve to a Book Study owned by the
   caller.
5. Deleting a Scroll Study SHALL NOT delete its Book Study; the Book Study remains and can
   receive a new scroll.

---

## Requirement 2: Book Study detail becomes the step hub

### User Story
As a Bible student, I want the book study page to be the home for everything I do on that
book, so that I navigate from the book to each step rather than from a standalone scroll.

### Acceptance Criteria
1. WHEN the user opens `/books/:bookStudyId` THEN the detail view SHALL show the book name,
   optional title/notes, timestamps, AND a **study steps** section reflecting the linked
   scroll.
2. WHEN the Book Study has no linked scroll THEN the steps section SHALL show an "Upload the
   scroll (Step 4)" action that creates a scroll attached to this Book Study.
3. WHEN the Book Study has a linked scroll THEN the steps section SHALL show the scroll's
   status and a step list that deep-links to the existing step views for that scroll:
   - Step 4 — Observe the Scroll → `/scroll/:scrollStudyId`
   - Step 6 — Pronouns → `/scroll/:scrollStudyId/pronouns`
   - Step 6 — Antecedents → `/scroll/:scrollStudyId/antecedents`
   - Step 6 — Referents → the referents editor (see Requirement 4)
   - Step 7 — Structure → `/scroll/:scrollStudyId/structure`
   - Step 8 — Outline → `/scroll/:scrollStudyId/outline`
   - Step 9 — Theme & Purpose → the outline view's top panel (same route as Step 8)
4. Each step link SHALL be keyboard operable and screen-reader labeled, matching existing
   ARIA patterns.
5. WHILE the scroll's status is `uploading`/`extracting` THE steps that depend on scroll text
   (6–9) SHALL be shown as not-yet-available (disabled or clearly marked), re-enabling when
   the scroll reaches `ready`.

---

## Requirement 3: Scroll and step views know their owning book

### User Story
As a Bible student working a step, I want to get back to the book that owns this scroll, so
that I never lose the containing context.

### Acceptance Criteria
1. The Scroll view SHALL show a "back to book study" link that routes to the owning
   `/books/:bookStudyId` when the scroll carries a `bookStudyId`.
2. The step entry links currently rendered inside the Scroll view (Find pronouns / Analyze
   structure / Make an outline) SHALL remain functional, so direct navigation and existing
   bookmarks do not break; the Book-detail hub becomes the primary entry point but is not the
   only one.
3. WHEN a scroll has no `bookStudyId` (a legacy orphan not yet backfilled) THEN the Scroll
   view SHALL still load and function; the back-to-book link SHALL be omitted rather than
   broken.

---

## Requirement 4: Referents move into the Step 6 area of the hub

### User Story
As a Bible student, I want referents to sit with the rest of my Step 6 pronoun/antecedent
work, so that related work is together instead of stranded on the book page.

### Acceptance Criteria
1. The referent list stored on the `BookStudy` record SHALL be unchanged in shape and SHALL
   NOT be migrated to another record.
2. The Book-detail page SHALL stop presenting referent editing as its primary content; the
   referent editor SHALL instead be reached from the Step 6 area of the steps section (a
   "Referents" step entry) rather than always-expanded on the book page.
3. All existing referent create/edit/remove/save behavior and validation SHALL be preserved;
   this requirement relocates the editor's entry point, not its logic.

---

## Requirement 5: Backfill existing scrolls to book studies

### User Story
As the maintainer, I want my existing scrolls and their step work to appear under a book
study after this change, so that nothing is orphaned by the new container model.

### Acceptance Criteria
1. A one-time, **idempotent** backfill SHALL, for each Scroll Study lacking a `bookStudyId`,
   find or create a Book Study for the same user whose `book` matches the scroll's
   `bookName`, and set the scroll's `bookStudyId` to it.
2. WHEN more than one orphan scroll shares a `bookName` for one user THEN the backfill SHALL
   attach the most-recently-updated scroll to the matched/created Book Study and SHALL leave
   the others orphaned with a logged warning (A1 allows only one scroll per book; the
   maintainer resolves extras manually). This SHALL NOT delete any record.
3. The backfill SHALL run against **dev** as part of this change's verification. Prod backfill
   SHALL be a separate, explicitly maintainer-run invocation (documented in the design), never
   automatic, because prod holds real data.
4. The backfill SHALL be safe to re-run: a scroll that already has a `bookStudyId` SHALL be
   skipped.

---

## Non-Functional Requirements

1. **Stack conformance.** Angular 21 standalone + signals + Bulma on the frontend; serverless
   (Lambda + API Gateway + DynamoDB) via CDK on the backend, consistent with the existing
   stack. No new always-on resources.
2. **Stateful safety.** No DynamoDB table is replaced, renamed, or deleted. `bookStudyId` is
   an additive non-key attribute on `ScrollStudies`. The `diff` stateful guard MUST report no
   replacement or deletion.
3. **Auth and scoping.** All routes keep the Cognito authorizer and derive `userId` from the
   `sub` claim, never from client input. A cross-record link (scroll → book) is validated for
   same-owner before it is written.
4. **Backward compatibility.** Legacy scrolls with no `bookStudyId`, and legacy book studies
   with referents, SHALL continue to load and function. No field is made required that would
   reject an existing record on read.
5. **Accessibility.** New hub UI SHALL be keyboard operable and screen-reader labeled,
   matching the existing ARIA patterns.

---

## Out of Scope

- The Word Study (Step 5, `/studies`) flow — not linked to a Book Study in this increment; it
  remains a separate top-level tool by decision.
- Allowing more than one scroll per Book Study (A1: exactly one).
- Re-keying the antecedent/structure/outline records to the Book Study; they stay keyed by
  `scrollStudyId` and are reached transitively.
- Any new Bible-study step tool (Step 10+ is tracked separately).
- Moving the stored referent list off the `BookStudy` record.
- The domain cutover from `wordstudy.*` to `axiostools.*` (tracked separately).
