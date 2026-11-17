# Design: Link word studies to a book

## Overview

One additive optional field, `bookStudyId`, on the `WordStudies` record. The Lambda validates it and
preserves it across saves that omit it. The frontend carries it through the worksheet model, adds a book
selector to the word study page, a column and filter to the list, and a word studies row to Book home.

## Data model

```ts
// infra/lambda/shared/models.ts
export interface WordStudyRecord {
  // ...existing fields
  bookStudyId?: string; // additive; absent = not linked
}

// src/app/models.ts
export interface StudyWorksheet {
  // ...existing fields
  bookStudyId: string; // '' = not linked (normalized on read)
}
```

No new table, key, index, or construct. `WordStudies` keys and `GSI1` are untouched, so the stateful guard is
unaffected.

## Lambda (`infra/lambda/study-crud/index.ts`)

### Parsing

`parseSaveBody` gains `bookStudyId`, as a tri-state:

| Body | Meaning | Stored result |
| --- | --- | --- |
| key absent | client did not say | keep existing value (new study: none) |
| `""` | unlink | attribute removed |
| valid string | link | attribute set |
| wrong type, over 64 chars, or characters outside `[A-Za-z0-9-]` | bad request | 400 |

The validation error is returned from the handler as
`{ message: 'bookStudyId must be 64 characters or fewer: letters, digits and hyphens.' }`.

### Preserving on omit

`saveWordStudy` currently builds a record and overwrites. When `bookStudyId` is `undefined` and the body
carries an `id` (an update), it first calls the existing `getStudy(userId, id)` and copies the stored
`bookStudyId` into the new record. That is one extra `GetItem` on updates only, using the read permission
the function already has. For a new study there is nothing to preserve.

`createdAt` handling is unchanged.

### Read paths

`getStudy` and `listStudies` already return the whole item, so `bookStudyId` flows through with no change.
When it is absent the field is omitted from the JSON.

### Tests (`infra/lambda/study-crud/index.test.ts`)

- Save with a valid id stores it; get and list return it.
- Update that omits the field keeps the stored value (asserts the `PutCommand` item).
- Update with `""` removes it (item has no `bookStudyId`).
- New study that omits it stores none.
- Wrong type, 65 characters, and a value with spaces or slashes each return 400 and do not write.
- The user id on the key always comes from the authorizer claims.
- SDK is mocked; nothing calls AWS.

## Frontend

### Service (`study-crud.service.ts`)

- `StudyRecord` gains `bookStudyId?: string`; `toWorksheet` maps it to `bookStudyId: record.bookStudyId ?? ''`.
- `saveStudy` always sends `bookStudyId: worksheet.bookStudyId` (including `''`), so the link round-trips
  on every save. Spec regression test: load a worksheet with a link, save it, assert the POST body still has
  it. This is the exact failure Learn progress had.

### Word study page (`study-page`)

- Injects `BookStudyService` (already exists, `list()`), loads books on init, non-blocking.
- State: `bookStudyId` signal, `books` signal, `booksLoaded` signal.
- New study: `bookStudyId` starts from `?bookStudyId=` if present, else `''`.
- Existing study: set from the loaded worksheet.
- `onSaveStudy` includes `bookStudyId` in the worksheet it builds (line near `StudyWorksheet = {`).
- A `<select>` above the worksheet, labeled "Book", with "No book" plus books (`book` name, and `— title`
  when set). Hidden when the book list fails to load (R2.4). If the stored id is not among the books, the
  select shows "No book" but the signal keeps the stale id until the student changes it (R2.5).
- The select lives in the page, not the worksheet component, so the worksheet's inputs and outputs are
  unchanged.

### List (`study-list`)

- Loads books once, non-blocking. A `bookName(id)` helper returns the name or `'—'`.
- New column "Book". A filter `<select>` ("All", "No book", each book) drives a `computed` of visible
  rows. Not persisted.

### Book home (`book-study-detail` and `step-list`)

- `BookStudyDetailComponent` loads `StudyCrudService.listStudies()` once the book loads (non-blocking,
  failure leaves the count empty) and filters by `bookStudyId`.
- Passes `wordStudies` (id, word, Strong's) and `bookStudyId` to `StepListComponent`. The Step 5 row shows
  "N word studies", an "Add word study" link to `/study/new?bookStudyId=<id>`, and an expandable list of
  links to `/study/:id`.
- On the scroll page the Step 5 row keeps its current simple link, since the scroll page has no book
  context beyond its own id.
- `StepListComponent` gains an optional `wordStudies` input and `bookStudyId` input; absent means the row
  stays as it is today.

## Edge cases

- Stale link (book deleted): shows as "No book" in the list and selector; harmless (A2, A3).
- Old SPA tab saving after the Lambda deploys: omits the field, so the Lambda preserves the stored link
  (A1). New SPA against old Lambda: the extra field is ignored and dropped on save, which is the same as
  today; the link simply does not persist until the Lambda deploys. Dev and prod deploy the Lambda and SPA
  together, so this window is minutes.
- Two tabs editing the same study: last write wins, as today.
- A student with no books: the selector shows only "No book"; the list filter shows All and No book.

## Rollout and risk

- CDK diff: Lambda asset hash and SPA asset hash only; no resource added, removed or replaced; no IAM
  change (A2).
- First write of the new field to prod data. It is optional and additive, existing records load unchanged,
  and omit-preserves protects against stale clients.
- Rollback: revert the PR. Records that already carry `bookStudyId` are ignored by the old code.

## Build order (one PR)

1. Lambda model, parsing, preserve-on-omit, and tests.
2. Frontend model and service mapping, with the round-trip regression test.
3. Word study page selector and tests, including the book-list failure path.
4. List column and filter.
5. Book home row and `StepListComponent` inputs.
