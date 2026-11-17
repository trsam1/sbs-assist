# Requirements: Link word studies to books

## Context and assumptions

The Book Study is the container for a student's work on a book (spec `link-studies-to-book`), but that
spec deliberately left the Step 5 Word Study alone. Word studies are still a flat list, so the first tool
built is the one tool that does not appear under its book. This spec closes that gap: a word study can be
linked to **one or more** books, the Book home shows its word studies, and the word study list can be
filtered by book.

A key word often matters in several books (for example "grace" in Romans and Ephesians), so the link is
many-to-many: one word study, many books; one book, many word studies.

A "word study" here is one saved record in the `WordStudies` table (a worksheet, today holding one word
entry). The links are a property of that record.

### Confirmed decisions

- **D1 — A word study can belong to any number of books** (zero, one, or several), chosen by the student.
  Unlinked word studies stay valid and keep working everywhere.
- **D2 — The links are an additive optional list attribute** `bookStudyIds` on the existing record. No key,
  index, table or construct changes.
- **D3 — Book home gets a word studies section** under Step 5. A word study linked to three books appears
  under all three.

### Assumptions (flagged for review)

- **A1 — Saving overwrites the whole record today** (`PutCommand`). A client that does not send the links
  would silently erase them, the same trap that bit Learn progress. So the Lambda **preserves the stored
  list when a save omits the field**, and only clears it when the client sends an empty list.
- **A2 — No existence check on the book ids in the Lambda.** Checking them would need new read access from
  the word study Lambda to the `BookStudies` table (an IAM change). The ids are only ever used client-side to
  match against the student's own books, so a stale or wrong id is harmless: it matches no book and is not
  shown.
- **A3 — Deleting a book study does not cascade**, as for scrolls today. Its id stays in the lists of its
  word studies but matches no book, so it is invisible. The word studies stay in the word study list.
- **A4 — Existing word studies have no links** and are not migrated. The student links them by opening one
  and choosing books.
- **A5 — Word studies remain reachable at `/studies`** and `/study/:id`; no route changes.
- **A6 — A word study can be linked to at most 66 books** (the number of books in the Bible), and the list
  has no duplicates.

## Requirement 1: Backend

1. **R1.1** `POST /studies` accepts an optional `bookStudyIds` array of strings. Each id is at most 64
   characters, letters, digits and hyphens only; the array has at most 66 entries. Duplicates are removed.
   Anything else (not an array, a non-string entry, a bad id, too many entries) returns 400 with a clear
   message.
2. **R1.2** If the body omits `bookStudyIds`, a save of an existing study keeps its stored list. A new study
   without it stores none.
3. **R1.3** If the body sends `bookStudyIds: []`, the stored list is removed.
4. **R1.4** `GET /studies` and `GET /studies/{id}` return `bookStudyIds` when non-empty and omit it when not.
5. **R1.5** The `WordStudyRecord` model gains `bookStudyIds?: string[]`. No table, index, key or IAM change.
6. **R1.6** A save never changes ownership: the record key still comes from the authenticated user.

## Requirement 2: Word study page

1. **R2.1** The word study page header has a "Books" control: a checkbox list of the student's book studies,
   labeled by book name (and title when present). Several can be checked.
2. **R2.2** Opening `/study/new?bookStudyId=<id>` starts with that book checked. Opening a saved study checks
   its stored books.
3. **R2.3** The choices are saved with the study. Unchecking every box and saving clears the links.
4. **R2.4** If the book list cannot be loaded, the control is hidden and the study's existing links are
   preserved on save (the client re-sends what it loaded).
5. **R2.5** Stored ids that match no current book (deleted books) are not shown. Saving without touching the
   selection keeps them; the first change to the selection drops them.

## Requirement 3: Word study list

1. **R3.1** The list shows a Books column: the linked book names, comma separated, or a dash.
2. **R3.2** A filter offers "All", "No book", and each book. Choosing a book shows every word study linked
   to it, including ones also linked to other books. It filters client-side and is not persisted.
3. **R3.3** Rows and actions behave as today.

## Requirement 4: Book home

1. **R4.1** The Step 5 row on Book home shows how many word studies are linked to this book and an "Add word
   study" button that opens `/study/new?bookStudyId=<id>`.
2. **R4.2** Expanding the row lists the linked word studies (word, Strong's number), each linking to
   `/study/:id`. A word study linked to several books appears on each of those books' pages.
3. **R4.3** Loading these is non-blocking and failure-tolerant: if the list call fails, the row shows no
   count and the rest of the page is unaffected.

## Requirement 5: Non-functional

1. **R5.1** CDK diff shows only Lambda and SPA asset-hash rotation. The stateful guard stays clean.
2. **R5.2** Tests: Lambda save/get/list with omit, set, clear, duplicates and invalid values; service
   mapping and save payload; page control behavior including the book-list failure path and stale ids; list
   filter with multi-book studies; Book home row. No test calls AWS.
3. **R5.3** The frontend `StudyCrudService` maps and re-sends `bookStudyIds` so the links survive every save,
   with a regression test (the failure mode from Learn progress).
4. **R5.4** One PR, built in this order: Lambda and model, service mapping, page control, list column and
   filter, Book home row.

## Out of scope

- Grouping word studies by the same Strong's word (issue #3), Greek/Hebrew grouping (#6), column sort (#5).
- Cascading or blocking deletes between books and their studies.
- Migrating existing word studies into books.
- Cross-user sharing of any kind.
