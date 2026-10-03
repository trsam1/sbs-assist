# Requirements: Organize Studies by Book of the Bible

## Context and Assumptions

The issue asks for an interface to "manage and organize study resources by book of the
Bible I'm studying," where a study is "defined by a book of the Bible" and can be added,
removed, and viewed. The existing app (Step 5 — Define Key Words) stores **word studies**,
each a worksheet tied to a Cognito user. There is currently no concept that groups a
student's work by the book they are studying.

This spec resolves the issue into a new first-class entity, a **Book Study**: a named
container, defined by a single book of the Bible, that a student creates to organize their
work for that book. In this first increment a Book Study holds its own metadata (book,
optional title/notes) and is the organizing shell; linking existing word studies into a
Book Study is called out but deferred (see Requirement 7 and Out of Scope). The reviewer's
rejection of the original issue is addressed by pinning down: what the entity is (a Book
Study container), its fields (Requirement 2), the UI surface and navigation (Requirements
1, 3, 4, 5), and how it relates to existing word studies (Requirement 7 / Out of Scope).

Assumptions (flagged for design review; each is the lowest-risk reading of the issue):

- **A1.** "A study" in the issue means a new **Book Study** container entity, distinct from
  the existing per-word `WordStudyEntry` / word-study worksheet. It does not rename or
  change the existing word-study feature.
- **A2.** A Book Study belongs to one authenticated Cognito user, consistent with how word
  studies are already scoped (`sub` claim via the Cognito authorizer).
- **A3.** The canonical list of books is the 66 books of the Protestant canon (39 OT + 27
  NT), matching the product's inductive-study framing. The list is a fixed, client-owned
  constant; it is not user-editable and is not stored per record beyond the chosen value.
- **A4.** This increment persists Book Studies and offers add / view (list + detail) /
  remove. Editing an existing Book Study's fields and attaching word studies to it are
  deferred to a later increment to keep scope small (Out of Scope).

---

## Requirement 1: Book Study navigation entry point

### User Story
As a Bible student, I want a dedicated place in the app to see and manage my book studies,
so that I can organize my work by the book of the Bible I am studying.

### Acceptance Criteria
1. WHEN a signed-in user views the main navigation THEN the system SHALL display a
   navigation item labeled "Book Studies" that routes to the Book Studies list.
2. The Book Studies list SHALL be reachable at the route path `/books`.
3. WHEN an unauthenticated user is present THEN the system SHALL NOT render the Book Studies
   navigation item or route content (the existing auth gate in `App` already blocks all
   routes until sign-in; this requirement SHALL reuse that gate, not add a new one).
4. The navigation item SHALL use the existing Bulma `navbar` styling and `routerLinkActive`
   active-state behavior already used by the "My Studies" and "New Study" items.

---

## Requirement 2: Book Study data model and fields

### User Story
As a Bible student, I want a book study to carry the book I am studying and a few descriptive
details, so that each entry is meaningful and identifiable in my list.

### Acceptance Criteria
1. A Book Study SHALL have the fields: `id` (string, server-generated), `userId` (string,
   from the Cognito `sub` claim), `book` (string, one of the 66 canonical book names),
   `title` (string, optional free text), `notes` (string, optional free text),
   `createdAt` (ISO 8601 string), and `updatedAt` (ISO 8601 string).
2. `book` SHALL be required and SHALL be one of the canonical 66 book names; a value outside
   that set SHALL be rejected (client validation blocks submit; server validation returns
   `400`).
3. `title` SHALL be optional; WHEN omitted THEN the display SHALL fall back to the `book`
   name.
4. `notes` SHALL be optional and SHALL accept multi-line free text up to 2000 characters;
   input longer than 2000 characters SHALL be rejected server-side with `400`.
5. The system SHALL allow more than one Book Study for the same `book` (duplicates are not
   an error); the list SHALL display enough fields (`title`/`book` and `updatedAt`) to tell
   them apart.

### Correctness Properties
- Property: For any `book` value in the canonical 66-name set, `isValidBook(book)` returns
  `true`; for any other string it returns `false`. `isValidBook` is a pure function.

---

## Requirement 3: Create a Book Study

### User Story
As a Bible student, I want to add a new book study by choosing a book of the Bible, so that
I can start organizing my work for that book.

### Acceptance Criteria
1. WHEN the user activates "New Book Study" from the Book Studies list THEN the system SHALL
   present a form with a book selector (the 66 canonical books), an optional title input,
   and an optional notes textarea.
2. The book selector SHALL be grouped or ordered so Old Testament books precede New Testament
   books in canonical order.
3. The "Save" action SHALL be disabled until a `book` is selected.
4. WHEN the user saves a valid new Book Study THEN the system SHALL `POST /books`, persist the
   record scoped to the authenticated user, and navigate to the Book Studies list (or the new
   book's detail view) on success.
5. IF the save request fails THEN the system SHALL keep the user's entered values and display
   an inline error with a retry affordance, consistent with the delete-error pattern in
   `StudyListComponent`.
6. The server SHALL set `userId` from the Cognito `sub` claim and SHALL ignore any `userId`
   supplied in the request body (same hardening as `study-crud`'s `POST /studies`).

---

## Requirement 4: View the list of Book Studies

### User Story
As a Bible student, I want to see all my book studies in one list, so that I can find and
open the book I am working on.

### Acceptance Criteria
1. WHEN the user opens `/books` THEN the system SHALL `GET /books` and display the user's Book
   Studies.
2. Each row SHALL show the title (or book name when title is empty), the book name, and the
   last-updated date (`updatedAt`, rendered with the Angular `date` pipe as elsewhere).
3. Book Studies SHALL be listed most-recently-updated first.
4. WHEN the user has no Book Studies THEN the system SHALL display an empty-state message
   inviting them to create one, matching the empty-state treatment in `StudyListComponent`.
5. WHILE the list request is in flight THE system SHALL show a loading indicator; IF the
   request fails THEN it SHALL show an error state with a retry button.
6. The list SHALL request data only for the authenticated user; the server SHALL return only
   records whose `userId` matches the Cognito `sub` claim.

---

## Requirement 5: View a single Book Study

### User Story
As a Bible student, I want to open a book study to see its details, so that I can review what
I am studying for that book.

### Acceptance Criteria
1. WHEN the user opens a Book Study from the list THEN the system SHALL route to
   `/books/:bookStudyId` and `GET /books/{bookStudyId}`.
2. The detail view SHALL display the book name, title (if any), notes (if any), and the
   created/updated timestamps.
3. IF the requested Book Study does not exist or does not belong to the user THEN the API
   SHALL return `404` and the UI SHALL show a not-found message with a link back to `/books`.

---

## Requirement 6: Remove a Book Study

### User Story
As a Bible student, I want to delete a book study I no longer need, so that my list stays
relevant.

### Acceptance Criteria
1. The Book Studies list and/or detail view SHALL offer a "Delete" action per Book Study.
2. WHEN the user activates Delete THEN the system SHALL show a confirmation modal before
   deleting, matching the `role="alertdialog"` confirmation pattern in `StudyListComponent`.
3. WHEN the user confirms THEN the system SHALL `DELETE /books/{bookStudyId}` and, on success,
   remove the row from the list without a full reload.
4. IF the delete request fails THEN the system SHALL leave the Book Study in place and show a
   dismissible error notification.
5. The server SHALL delete only a record owned by the authenticated user; a delete for a
   non-existent or non-owned id SHALL return `404` and SHALL NOT delete anything.
6. Deleting a Book Study SHALL NOT delete any word studies (word studies are stored
   separately and are not yet linked; see Out of Scope).

---

## Requirement 7: Relationship to existing word studies

### User Story
As a Bible student, I want my book studies to be the organizing layer for the per-word
studies I already create, so that over time my work is grouped by book.

### Acceptance Criteria
1. This increment SHALL NOT modify the existing `WordStudies` table schema, the existing
   `WordStudyEntry` / `StudyWorksheet` models, or the existing `/studies` and
   `/ai/study-summary` routes.
2. The Book Study data model SHALL be designed so a later increment can associate word
   studies with a Book Study (e.g. a `bookStudyId` reference) without a breaking migration;
   adding such a link is deferred (Out of Scope).
3. The existing "My Studies" / "New Study" word-study flows SHALL continue to work unchanged.

---

## Non-Functional Requirements

1. **Stack conformance.** Frontend changes SHALL use Angular 21 standalone components with
   signals and Bulma styling, consistent with existing components. Backend changes SHALL be
   serverless (Lambda + API Gateway + DynamoDB) via CDK, consistent with the existing stack.
2. **Auth and scoping.** All `/books` routes SHALL require the Cognito authorizer and SHALL
   derive `userId` from the token's `sub` claim, never from client input.
3. **CORS and throttling.** New routes SHALL inherit the API's existing CORS allow-list and
   usage-plan throttling; no new always-on resources SHALL be introduced.
4. **Cost.** Persistence SHALL reuse DynamoDB on-demand billing; no new table is introduced
   unless the design justifies it (see design.md — a new on-demand table is proposed and its
   cost is negligible under the dev/prod cost model).
5. **Accessibility.** New UI SHALL be keyboard operable and screen-reader labeled, matching
   the ARIA patterns already used (`aria-label`, `aria-live`, `role="alertdialog"`,
   `is-sr-only`).

---

## Out of Scope

- Editing an existing Book Study's fields after creation (create / view / delete only this
  increment).
- Attaching, moving, or displaying word studies inside a Book Study (the link field is
  reserved in the model but not populated or surfaced yet).
- Tools for Bible-study steps other than Step 5; a Book Study groups work but does not add
  new step tools.
- Sharing, exporting, or collaboration on Book Studies.
- Changing the existing word-study (`/studies`) data model, routes, or UI.
- The domain cutover from `wordstudy.*` to `axiostools.*` (tracked separately).
