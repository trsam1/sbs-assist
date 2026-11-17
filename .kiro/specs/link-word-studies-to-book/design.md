# Design: Link word studies to books

## Overview

One additive optional list field, `bookStudyIds`, on the `WordStudies` record. The Lambda validates it and
preserves it across saves that omit it. The frontend carries it through the worksheet model, adds a
multi-select books control to the word study page, a column and filter to the list, and a word studies row
to Book home.

## Data model

```ts
// infra/lambda/shared/models.ts
export interface WordStudyRecord {
  // ...existing fields
  bookStudyIds?: string[]; // additive; absent = not linked to any book
}

// src/app/models.ts
export interface StudyWorksheet {
  // ...existing fields
  bookStudyIds: string[]; // [] = not linked (normalized on read)
}
```

No new table, key, index, or construct. `WordStudies` keys and `GSI1` are untouched, so the stateful guard is
unaffected. The "which word studies belong to this book" question is answered client-side from the user's
own list (`GET /studies`), so no new index is needed: a student has a small number of word studies, and the
list call already exists.

## Lambda (`infra/lambda/study-crud/index.ts`)

### Parsing

`parseSaveBody` gains `bookStudyIds`, as a tri-state:

| Body | Meaning | Stored result |
| --- | --- | --- |
| key absent | client did not say | keep existing list (new study: none) |
| `[]` | unlink from all | attribute removed |
| array of valid ids | set | de-duplicated list stored |
| not an array, non-string entry, id over 64 chars or outside `[A-Za-z0-9-]`, more than 66 entries | bad request | 400 |

Duplicates are removed (order of first appearance kept) before the length check, so repeating an id never
trips the 66 limit. The error is returned as
`{ message: 'bookStudyIds must be an array of at most 66 ids (letters, digits, hyphens; 64 characters or fewer each).' }`.

### Preserving on omit

`saveWordStudy` currently builds a record and overwrites. When `bookStudyIds` is `undefined` and the body
carries an `id` (an update), it first calls the existing `getStudy(userId, id)` and copies the stored
`bookStudyIds` into the new record. That is one extra `GetItem` on updates only, using the read permission
the function already has. For a new study there is nothing to preserve. An empty array removes the
attribute rather than storing `[]`.

`createdAt` handling is unchanged.

### Read paths

`getStudy` and `listStudies` already return the whole item, so `bookStudyIds` flows through with no change.
When it is absent the field is omitted from the JSON.

### Tests (`infra/lambda/study-crud/index.test.ts`)

- Save with valid ids stores them; get and list return them.
- A study linked to two books returns both.
- Duplicate ids are stored once.
- Update that omits the field keeps the stored list (asserts the `PutCommand` item).
- Update with `[]` removes it (item has no `bookStudyIds`).
- New study that omits it stores none.
- Not an array, a non-string entry, a 65-character id, an id with a space or slash, and 67 distinct ids each
  return 400 and do not write.
- The user id on the key always comes from the authorizer claims.
- SDK is mocked; nothing calls AWS.

## Frontend

### Service (`study-crud.service.ts`)

- `StudyRecord` gains `bookStudyIds?: string[]`; `toWorksheet` maps it to `bookStudyIds: record.bookStudyIds ?? []`.
- `saveStudy` always sends `bookStudyIds: worksheet.bookStudyIds` (including `[]`), so the links round-trip on
  every save. Regression test: load a worksheet with links, save it, assert the POST body still has them.
  This is the exact failure Learn progress had.

### Word study page (`study-page`)

- Injects `BookStudyService` (already exists, `list()`), loads books on init, non-blocking.
- State: `bookStudyIds` signal (all stored ids, including stale ones), `books` signal, `booksLoaded` signal.
- New study: `bookStudyIds` starts as `[?bookStudyId]` if the query param is present, else `[]`.
- Existing study: set from the loaded worksheet.
- `onSaveStudy` includes `bookStudyIds` in the worksheet it builds (near `StudyWorksheet = {`).
- A "Books" fieldset above the worksheet: one checkbox per book (`book` name, and `— title` when set),
  checked when its id is in `bookStudyIds`. Toggling adds or removes that id. The first toggle also drops ids
  that match no loaded book (R2.5). Hidden when the book list fails to load (R2.4).
- The control lives in the page, not the worksheet component, so the worksheet's inputs and outputs are
  unchanged.
- Accessibility: a real `fieldset` with a `legend`, native checkboxes with labels.

### List (`study-list`)

- Loads books once, non-blocking. A `bookNames(ids)` helper returns the names of ids that match a loaded
  book, joined with a comma, or `'—'`.
- New column "Books". A filter `<select>` ("All", "No book", each book) drives a `computed` of visible rows:
  a book filter keeps rows whose `bookStudyIds` include it; "No book" keeps rows with no id matching any
  loaded book. Not persisted.

### Book home (`book-study-detail` and `step-list`)

- `BookStudyDetailComponent` loads `StudyCrudService.listStudies()` once the book loads (non-blocking,
  failure leaves the count empty) and keeps the studies whose `bookStudyIds` include this book's id.
- Passes `wordStudies` (id, word, Strong's) and `bookStudyId` to `StepListComponent`. The Step 5 row shows
  "N word studies", an "Add word study" link to `/study/new?bookStudyId=<id>`, and an expandable list of
  links to `/study/:id`.
- On the scroll page the Step 5 row keeps its current simple link, since the scroll page has no book
  context beyond its own id.
- `StepListComponent` gains optional `wordStudies` and `bookStudyId` inputs; absent means the row stays as
  it is today.

## Edge cases

- Deleted book: its id stays in the stored list, matches no book, and is invisible (A2, A3).
- Old SPA tab saving after the Lambda deploys: omits the field, so the Lambda preserves the stored list
  (A1). New SPA against old Lambda: the extra field is ignored and dropped on save, the same as today; the
  links do not persist until the Lambda deploys. Dev and prod deploy the Lambda and SPA together, so this
  window is minutes.
- Two tabs editing the same study: last write wins, as today.
- A student with no books: the control is empty with a short "No books yet" note; the list filter shows All
  and No book.
- A study linked to many books: appears once in the word study list, and on each linked book's page.

## Rollout and risk

- CDK diff: Lambda asset hash and SPA asset hash only; no resource added, removed or replaced; no IAM
  change (A2).
- First write of the new field to prod data. It is optional and additive, existing records load unchanged,
  and omit-preserves protects against stale clients.
- Rollback: revert the PR. Records that already carry `bookStudyIds` are ignored by the old code.

## Build order (one PR)

1. Lambda model, parsing, preserve-on-omit, and tests.
2. Frontend model and service mapping, with the round-trip regression test.
3. Word study page books control and tests, including the book-list failure path and stale ids.
4. List column and filter, with a multi-book study.
5. Book home row and `StepListComponent` inputs.
