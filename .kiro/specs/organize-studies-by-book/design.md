# Design Document: Organize Studies by Book of the Bible

## Overview

This feature introduces a **Book Study**: a user-owned container, defined by a book of the
Bible, that organizes a student's work for that book. It adds a new section to the Angular
app (a "Book Studies" list, a create form, and a detail view) and a new serverless CRUD path
(`/books`) backed by a Lambda and a DynamoDB table. In this first increment a Book Study
holds its own metadata (book, optional title, optional notes) and supports create, list,
view, and delete. Linking existing word studies into a Book Study is deliberately deferred;
the data model reserves room for it so the later increment is additive.

The feature fits the existing architecture exactly. The frontend mirrors the structure of
the current word-study feature: standalone components with signals and Bulma, lazy-loaded
routes, a thin `HttpClient` service, and the existing `userIdInterceptor` that attaches the
Cognito bearer token. The backend mirrors `study-crud`: a single `NodejsFunction` behind the
API Gateway Cognito authorizer, reading the user from the `sub` claim and using the shared
`corsResponse` helper. Persistence follows the same `PK`/`SK` + `GSI1` single-table pattern
already used by `WordStudies`.

## Architecture

```mermaid
graph TD
    subgraph Frontend ["Frontend (Angular 21 + Bulma)"]
        NAV[App nav: Book Studies]
        BL[BookStudyListComponent /books]
        BF[BookStudyFormComponent /books/new]
        BD[BookStudyDetailComponent /books/:id]
        BSVC[BookStudyService]
        BOOKS[bible-books.ts constant]
    end

    subgraph AWS ["AWS Cloud"]
        APIGW[API Gateway + Cognito authorizer]
        BFn[BookStudyCrudFn - Lambda]
        DDB[(BookStudies DynamoDB table)]
    end

    NAV --> BL
    BL --> BF
    BL --> BD
    BL --> BSVC
    BF --> BSVC
    BD --> BSVC
    BF --> BOOKS
    BSVC --> APIGW
    APIGW --> BFn
    BFn --> DDB
```

The `userIdInterceptor` already attaches the `Authorization` bearer token to any request
whose URL contains `/studies` or `/ai/`. This design extends that predicate to also match
`/books` so the new service's calls are authenticated the same way (see Components → Frontend
wiring). No new auth mechanism is introduced.

## Decisions

**New table vs. reuse `WordStudies`.** Two options: (a) store Book Studies as new item types
inside the existing `WordStudies` table (e.g. `SK = BOOK#<id>`), or (b) create a dedicated
`BookStudies` table. We choose **(b), a new table**. Rationale: it keeps the two entities'
access patterns, item shapes, and lifecycles cleanly separated; it avoids touching a
stateful, point-in-time-recovery-protected table that holds the user's existing work (the
delivery rules forbid risky changes to stateful resources); and the marginal cost is
effectively zero under on-demand billing (consistent with the delivery cost model). The new
table reuses the identical `PK`/`SK` + `GSI1` layout so the `study-crud` patterns transfer
directly. This is additive — no change to `WordStudies` construct ID, physical name, schema,
or PITR setting.

**One Lambda per domain.** We add a single `BookStudyCrudFn` handling all four `/books`
methods, mirroring how `study-crud` handles all `/studies` methods in one function. This
keeps the function count and IAM surface small (one function, scoped read/write to the one
new table) rather than splitting per verb.

**Canonical book list owned by the frontend.** The 66-book list is a static TypeScript
constant (`bible-books.ts`) shared by the form (to populate the selector) and by validation.
The Lambda carries its own copy of the same list under `infra/lambda/shared/` for
server-side validation, since the frontend and Lambda are separate bundles and the Lambda
must not trust client input. The two lists are identical by construction; a unit test on each
side asserts length 66 and OT/NT split (39/27) to catch drift.

**Edit deferred.** The increment is create/view/delete only (Requirement, A4). Omitting edit
removes a `PUT`/update path and its optimistic-concurrency questions from this pass; a later
increment can add `PUT /books/{id}` additively.

## Components and Interfaces

### Frontend components (Angular 21 standalone, signals, Bulma)

All three components follow the existing conventions: `ChangeDetectionStrategy.OnPush`,
`inject()` for dependencies, `signal()` for state, inline templates with Bulma classes,
`data-testid` hooks, and co-located `*.spec.ts` tests (Angular + vitest).

- **`BookStudyListComponent`** (`src/app/book-study-list/`, route `/books`). Modeled on
  `StudyListComponent`. Holds `state: signal<'idle'|'loading'|'loaded'|'error'>` and
  `bookStudies: signal<BookStudy[]>`. On init calls `BookStudyService.list()`. Renders a
  Bulma table (title/book, book, last updated, actions), an empty state, a loading state, an
  error state with Retry, and a "New Book Study" button routing to `/books/new`. Reuses the
  delete-confirmation modal pattern (`role="alertdialog"`, `studyToDelete`-style signal,
  `deleting` and `deleteError` signals).

- **`BookStudyFormComponent`** (`src/app/book-study-form/`, route `/books/new`). A create
  form with a `<select>` populated from `BIBLE_BOOKS` (OT group then NT group via
  `<optgroup>`), an optional title `<input>`, and an optional notes `<textarea>`. Save is
  disabled until `book` is chosen. On submit, calls `BookStudyService.create(...)`, then
  navigates to `/books` on success or shows an inline error (preserving entered values) on
  failure. Mirrors the validation-and-error UX of `StudyInputComponent` /
  `StudyListComponent`.

- **`BookStudyDetailComponent`** (`src/app/book-study-detail/`, route `/books/:bookStudyId`).
  Reads the route param via `ActivatedRoute` (as `StudyPageComponent` does), calls
  `BookStudyService.get(id)`, and renders the book, title, notes, and timestamps. Offers
  Delete (reusing the confirmation modal) and a "Back to Book Studies" link. On `404`, shows
  a not-found message linking to `/books`.

### Frontend service and wiring

- **`BookStudyService`** (`src/app/book-study.service.ts`, `providedIn: 'root'`). Thin
  wrapper over `HttpClient`, mirroring `StudyCrudService`:
  ```typescript
  list(): Observable<BookStudy[]>                 // GET  /books
  get(id: string): Observable<BookStudy>          // GET  /books/{id}
  create(input: BookStudyInput): Observable<string> // POST /books -> bookStudyId
  delete(id: string): Observable<void>            // DELETE /books/{id}
  ```
  `baseUrl` comes from `environment.apiUrl`, as in the existing services.

- **Routes** (`src/app/app.routes.ts`): add three lazy `loadComponent` routes — `books`,
  `books/new`, `books/:bookStudyId` — matching the existing lazy-route style. The more
  specific `books/new` is listed before `books/:bookStudyId` so it is not swallowed by the
  param route.

- **Navigation** (`src/app/app.ts`): add a `routerLink="/books"` navbar item ("Book
  Studies") alongside "My Studies" and "New Study", with the same `routerLinkActive`
  behavior. No change to the auth gate — all routes already render only when
  `auth.isSignedIn()`.

- **Interceptor** (`src/app/user-id.interceptor.ts`): extend the match predicate so URLs
  containing `/books` also receive the `Authorization` header:
  `if (!req.url.includes('/studies') && !req.url.includes('/ai/') && !req.url.includes('/books'))`.

### Backend Lambda

- **`BookStudyCrudFn`** (`infra/lambda/book-study-crud/index.ts`). Structured exactly like
  `study-crud/index.ts`: resolves `origin` via `getRequestOrigin`, reads `userId` via
  `event.requestContext.authorizer.claims.sub`, dispatches on `httpMethod` + `resource`, and
  returns via `corsResponse`. Handlers: `POST /books`, `GET /books`, `GET /books/{bookStudyId}`,
  `DELETE /books/{bookStudyId}`. The table name comes from a `BOOK_STUDIES_TABLE_NAME`
  environment variable.

## Data Model

### Shared TypeScript model

Add to both `src/app/models.ts` (frontend) and `infra/lambda/shared/models.ts` (backend):

```typescript
/** A user-owned container that organizes study work by a book of the Bible. */
export interface BookStudy {
  id: string;         // server-generated UUID
  userId: string;     // Cognito sub
  book: string;       // one of the 66 canonical book names
  title: string;      // optional display title; '' when unset
  notes: string;      // optional free text; '' when unset
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
  // Reserved for a later increment that links word studies; not populated yet.
  // wordStudyIds?: string[];
}

/** Create payload from the form (server sets id/userId/timestamps). */
export interface BookStudyInput {
  book: string;
  title?: string;
  notes?: string;
}
```

### DynamoDB table: BookStudies

A new CDK `dynamodb.Table` in `WordStudyToolStack`, named `n('BookStudies')` (stage suffix,
so prod is `BookStudies` and dev is `BookStudies-dev`), with the same key layout, billing,
encryption, removal policy, and `GSI1` as `WordStudies`:

```typescript
interface BookStudyRecord {
  PK: string;        // "USER#<userId>"
  SK: string;        // "BOOKSTUDY#<bookStudyId>"
  bookStudyId: string;
  userId: string;
  book: string;
  title: string;
  notes: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  GSI1PK: string;    // "USER#<userId>"
  GSI1SK: string;    // "UPDATED#<updatedAt>" — sort by most recent
}
```

**Access patterns**
- Create / update: `PutCommand` with `PK = USER#<userId>`, `SK = BOOKSTUDY#<id>`.
- Get one: `GetCommand` on `PK`/`SK`; a result with a non-matching `userId` is impossible
  because `PK` embeds the caller's `userId`.
- List for user: `QueryCommand` on `GSI1`, `GSI1PK = USER#<userId>`, `ScanIndexForward: false`
  (most-recent first) — identical to `listStudies`.
- Delete: read-then-`DeleteCommand`, returning `404` when absent — identical to `deleteStudy`.

**CDK wiring (additive, non-stateful-breaking):** new construct id `BookStudies` and matching
log-group/grants; `this.bookStudiesTable.grantReadWriteData(bookStudyCrudFn)`; new
`NodejsFunction` with `functionName: n('BookStudyCRUD')`; `/books` resources on
`this.api.root` with `authMethodOptions` on every method, exactly as `/studies`. No existing
construct id or physical name changes. `removalPolicy` and PITR follow the per-stage
`StageConfig` values already used for the other tables (no change to `stage-config.ts` prod
values).

### Canonical book list

`src/app/bible-books.ts` and `infra/lambda/shared/bible-books.ts`:

```typescript
export const OLD_TESTAMENT_BOOKS: readonly string[] = [/* 39 names, Genesis…Malachi */];
export const NEW_TESTAMENT_BOOKS: readonly string[] = [/* 27 names, Matthew…Revelation */];
export const BIBLE_BOOKS: readonly string[] = [...OLD_TESTAMENT_BOOKS, ...NEW_TESTAMENT_BOOKS];
export function isValidBook(book: string): boolean { return BIBLE_BOOKS.includes(book); }
```

## API

All routes require the Cognito authorizer; `userId` is the token `sub`.

| Method | Path | Request body | Success | Errors |
|---|---|---|---|---|
| POST | `/books` | `{ book, title?, notes? }` | `200 { bookStudyId }` | `400` invalid/missing book, title/notes too long, missing auth |
| GET | `/books` | — | `200 BookStudyRecord[]` | `400` missing auth |
| GET | `/books/{bookStudyId}` | — | `200 BookStudyRecord` | `400` missing auth/id; `404` not found |
| DELETE | `/books/{bookStudyId}` | — | `200 { message }` | `400` missing auth/id; `404` not found |
| OPTIONS | all | — | CORS preflight (API default) | — |

The response records use DynamoDB field names (`bookStudyId`, etc.); the frontend service
maps them to the `BookStudy` model (`id = bookStudyId`), mirroring `StudyCrudService.toWorksheet`.

## Validation

Server-side, in `BookStudyCrudFn`, before any write (client-side mirrors these for UX but is
never trusted):

- **book** — required; `typeof === 'string'` and `isValidBook(book) === true`, else `400`
  `"Invalid or missing book."`.
- **title** — optional; if present must be a string ≤ 200 chars, else `400`. Absent/empty →
  stored as `""`.
- **notes** — optional; if present must be a string ≤ 2000 chars, else `400`. Absent/empty →
  stored as `""`.
- **userId** — taken only from the `sub` claim; any `userId` in the body is ignored (same as
  `study-crud`). Missing claim → `400 "Missing authentication."`.
- **bookStudyId** path param — required for get/delete; missing → `400`.

Parsing follows `study-crud`'s `parseSaveBody`: JSON-parse in a `try/catch`, reject
non-objects, and return `null` → `400` on malformed bodies.

## Error Handling

| Operation | Failure condition | Caller receives | Recoverable? | Logged |
|---|---|---|---|---|
| `POST /books` | malformed JSON / bad field | `400` + message | yes (user fixes input) | no (expected 4xx) |
| `POST /books` | DynamoDB `PutCommand` throws | `500` + message | yes (user retries; form keeps values) | implicitly via Lambda error path |
| `GET /books` | DynamoDB query throws | `500` + message | yes (list shows error + Retry) | as above |
| `GET /books/{id}` | item absent / other user | `404` "Study not found." | n/a (UI links back) | no |
| `DELETE /books/{id}` | item absent | `404` | n/a | no |
| `DELETE /books/{id}` | delete throws | `500` + message | yes (row stays, dismissible error) | as above |
| any handler | unexpected throw | `500 { message }` via the top-level `try/catch` | depends | message surfaced to CloudWatch |

The handler wraps its dispatch in a single `try/catch` returning `corsResponse(500, { message })`,
identical to `study-crud`. CloudWatch retention follows the per-stage `StageConfig`
(`logRetention`) already applied to the other functions; no new logging level is added.

Frontend error UX reuses existing patterns: list error state with Retry
(`StudyListComponent`), dismissible delete-error notification, and inline create-form error
that preserves entered values.

## Testing Strategy

### Unit tests
- **Lambda** (`infra/lambda/book-study-crud/index.test.ts`, vitest, mocked DynamoDB via the
  no-AWS setup): each method's success path; `userId` taken from claims and body `userId`
  ignored; validation rejects missing/invalid `book`, over-long `title`/`notes`, malformed
  JSON; `404` on get/delete of absent id; `400` on missing auth/id. No AWS endpoint is ever
  hit (uses `infra/test/setup-no-aws.ts`).
- **Shared validation / books** (`infra/lambda/shared/bible-books.test.ts` and the frontend
  `bible-books.spec.ts`): `isValidBook` true for canonical names, false otherwise;
  `BIBLE_BOOKS.length === 66`, OT 39 / NT 27; the two copies are identical.
- **Frontend components** (`*.spec.ts`, Angular + vitest, `HttpClient` mocked like the
  existing service specs): list renders rows / empty / loading / error; create disables Save
  until a book is chosen and surfaces errors without losing input; detail renders fields and
  handles `404`; delete uses the confirmation modal and removes the row on success.
- **Service** (`book-study.service.spec.ts`): each method hits the right URL/verb and maps
  `bookStudyId → id`.
- **Interceptor** (`user-id.interceptor.spec.ts`): a `/books` request receives the
  `Authorization` header; an external URL still does not.

### Property-based tests (fast-check, matching the existing `*.spec` conventions)
- For any string in `BIBLE_BOOKS`, `isValidBook` is `true`; for any string not in the set,
  `false`.
- For any valid `BookStudyInput`, the Lambda `POST` → `GET` round-trip returns a record whose
  `book`/`title`/`notes` match the input and whose `createdAt` is preserved while `updatedAt`
  is refreshed (parallels the `saveWordStudy` property).

### CDK assertion tests (`infra/test/`)
- The template contains a `BookStudies` table with `PAY_PER_REQUEST`, AWS-managed encryption,
  and a `GSI1`; a `BookStudyCRUD` function; and `/books` methods guarded by the Cognito
  authorizer. The stateful-guard test (existing) continues to pass because the new table is
  additive and uses the stage removal policy — no existing stateful resource is replaced or
  deleted.

## Risks

- **Product-meaning risk.** The core interpretation — that "a study defined by a book" is a
  new Book Study container rather than a re-shaping of word studies — is an assumption (A1).
  It is the lowest-risk reading and is additive; if the user actually wanted word studies
  tagged with a book instead, the design review / spec PR review is the gate to catch it
  before any code is written.
- **List drift between frontend and Lambda book lists.** Mitigated by the length/split unit
  tests on both copies.
- **Scope creep toward edit/linking.** Explicitly deferred and fenced in Out of Scope; the
  model reserves `wordStudyIds` so the later increment stays additive.
- **CDK context / lookups.** None added — the feature introduces no new `fromLookup`, so no
  `cdk.context.json` change is required.

## Out of Scope

- Editing a Book Study's fields after creation (`PUT /books/{id}`).
- Linking, moving, or rendering word studies within a Book Study (model field reserved only).
- New step tools beyond Step 5.
- Sharing, export, or collaboration.
- Any change to the `WordStudies` table, `/studies`, or `/ai/study-summary`.
- The `wordstudy.* → axiostools.*` domain cutover.
```
