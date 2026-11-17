# Requirements: Link word studies to a book

## Context and assumptions

The Book Study is the container for a student's work on a book (spec `link-studies-to-book`), but that
spec deliberately left the Step 5 Word Study alone. Word studies are still a flat list, so the first tool
built is the one tool that does not appear under its book. This spec closes that gap: a word study can
belong to one book, the Book home shows its word studies, and the word study list can be filtered by book.

A "word study" here is one saved record in the `WordStudies` table (a worksheet, today holding one word
entry). The link is a property of that record.

### Confirmed decisions

- **D1 — A word study belongs to at most one book**, chosen by the student. Unlinked word studies stay
  valid and keep working everywhere.
- **D2 — The link is an additive optional attribute** `bookStudyId` on the existing record, the same
  pattern as the scroll link. No key, index, table or construct changes.
- **D3 — Book home gets a word studies section** under Step 5.

### Assumptions (flagged for review)

- **A1 — Saving overwrites the whole record today** (`PutCommand`). A client that does not send the link
  would silently erase it, the same trap that bit Learn progress. So the Lambda **preserves the stored link
  when a save omits the field**, and only clears it when the client sends an empty string.
- **A2 — No existence check on the book id in the Lambda.** Checking it would need new read access from the
  word study Lambda to the `BookStudies` table (an IAM change). The id is only ever used client-side to
  match against the student's own books, so a stale or wrong id is harmless: it shows as "no book".
- **A3 — Deleting a book study does not cascade**, as for scrolls today. Its word studies become unlinked
  in practice (the id matches no book) and stay in the word study list.
- **A4 — Existing word studies have no link** and are not migrated. The student links them by opening one
  and choosing a book.
- **A5 — Word studies remain reachable at `/studies`** and `/study/:id`; no route changes.

## Requirement 1: Backend

1. **R1.1** `POST /studies` accepts an optional `bookStudyId` string, at most 64 characters, containing only
   letters, digits and hyphens. Anything else returns 400 with a clear message.
2. **R1.2** If the body omits `bookStudyId`, a save of an existing study keeps its stored value. A new study
   without it stores none.
3. **R1.3** If the body sends `bookStudyId: ""`, the stored link is removed.
4. **R1.4** `GET /studies` and `GET /studies/{id}` return `bookStudyId` when set and omit it when not.
5. **R1.5** The `WordStudyRecord` model gains `bookStudyId?: string`. No table, index, key or IAM change.
6. **R1.6** A save never changes ownership: the record key still comes from the authenticated user.

## Requirement 2: Word study page

1. **R2.1** The word study page header has a "Book" selector: "No book" plus the student's book studies,
   labeled by book name (and title when present).
2. **R2.2** Opening `/study/new?bookStudyId=<id>` preselects that book. Opening a saved study selects its
   stored book.
3. **R2.3** The choice is saved with the study. Changing it and saving updates the link; choosing "No book"
   clears it.
4. **R2.4** If the book list cannot be loaded, the selector is hidden and the study's existing link is
   preserved on save (the client re-sends what it loaded).
5. **R2.5** If the stored link matches no current book (deleted book), the selector shows "No book" and
   saving without a change keeps the stale id until the student picks something else.

## Requirement 3: Word study list

1. **R3.1** The list shows a Book column (book name, or a dash).
2. **R3.2** A filter offers "All", "No book", and each book. It filters client-side and is not persisted.
3. **R3.3** Rows and actions behave as today.

## Requirement 4: Book home

1. **R4.1** The Step 5 row on Book home shows how many word studies are linked and an "Add word study"
   button that opens `/study/new?bookStudyId=<id>`.
2. **R4.2** Expanding the row lists the linked word studies (word, Strong's number), each linking to
   `/study/:id`.
3. **R4.3** Loading these is non-blocking and failure-tolerant: if the list call fails, the row shows no
   count and the rest of the page is unaffected.

## Requirement 5: Non-functional

1. **R5.1** CDK diff shows only Lambda and SPA asset-hash rotation. The stateful guard stays clean.
2. **R5.2** Tests: Lambda save/get/list with omit, set, clear and invalid values; service mapping and
   save payload; page selector behavior including the book-list failure path; list filter; Book home row.
   No test calls AWS.
3. **R5.3** The frontend `StudyCrudService` maps and re-sends `bookStudyId` so the link survives every
   save, with a regression test (the failure mode from Learn progress).
4. **R5.4** One PR, built in this order: Lambda and model, service mapping, page selector, list column and
   filter, Book home row.

## Out of scope

- Grouping word studies by the same Strong's word (issue #3), Greek/Hebrew grouping (#6), column sort (#5).
- Cascading or blocking deletes between books and their studies.
- Migrating existing word studies into books.
- Cross-user sharing of any kind.
