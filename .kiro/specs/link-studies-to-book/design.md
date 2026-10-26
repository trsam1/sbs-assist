# Design: Make the Book Study the container for all step work

## Overview

Link every Scroll Study to an owning Book Study via an additive `bookStudyId` attribute, then
reorient navigation so the Book Study detail page is the hub from which a student reaches each
step. Because all downstream step records (antecedents, structure, outline) are already keyed
by `scrollStudyId`, linking the Scroll to the Book transitively brings the whole step chain
under the Book with **no change to those tables**.

This is a frontend + Lambda + one-time-backfill change. **No DynamoDB table is replaced,
renamed, or deleted**, so the `diff` stateful guard stays green. `bookStudyId` is a non-key
attribute added to the `ScrollStudies` single-table items.

## Current state (ground truth)

- `ScrollStudies` is a single-table design: `PK=USER#<sub>`, `SK=SCROLL#<id>`, plus `GSI1`
  (`GSI1PK=USER#<sub>`, `GSI1SK=UPDATED#<iso>`) for per-user listing. The record carries
  `scrollStudyId`, `userId`, `bookName`, `objectKey`, `status`, `scrollText`, `truncated`,
  `failureReason`, timestamps. **No `bookStudyId`.**
- `BookStudies` mirrors that shape: `PK=USER#<sub>`, `SK=BOOKSTUDY#<id>`, `GSI1` for listing,
  carrying `book`, `title`, `notes`, `referents[]`, timestamps.
- Antecedent / Structure / Outline records are keyed by `scrollStudyId` and reached from
  `/scroll/:scrollStudyId/...` buttons in the Scroll view.
- `BookStudyDetailComponent` currently renders a Referents editor as its main content.

## Data model changes

### `ScrollStudy` / `ScrollStudyRecord` — add `bookStudyId`

Frontend `ScrollStudy` and backend `ScrollStudyRecord` gain:

```ts
bookStudyId: string; // owning Book Study; '' on legacy orphans until backfilled
```

- Additive, non-key. Legacy records read `bookStudyId = ''` (the service defaults it, like
  `scrollText ?? ''`). No field becomes required on read.
- The `createScrollStudy` path accepts `bookStudyId` in the create body, validates it
  resolves to a caller-owned Book Study (a `GetCommand` on `PK=USER#<sub>`,
  `SK=BOOKSTUDY#<bookStudyId>`), and persists it; `bookName` is set from that Book Study's
  `book` rather than free text.

No change to `BookStudy` (referents stay as-is per Requirement 4 / A5).

## Backend changes

### scroll-study Lambda (`infra/lambda/scroll-study/index.ts`)

1. **`parseCreateBody`** — accept an optional `bookStudyId` string. When present it must be a
   non-empty string; when absent, reject (creates now always come from a Book Study per the
   new flow) **unless** a compatibility flag is set — see the migration note. Decision: make
   `bookStudyId` **required** on the create path, since the only create entry point after this
   change is "upload the scroll for this book study." Direct book-less scroll creation is
   removed from the UI.
2. **`createScrollStudy`** — look up the Book Study (`GetCommand`, same-owner PK). Return
   `400` if it is missing or not owned. Set `record.bookStudyId` and `record.bookName =
   bookStudy.book`.
3. **GET / list / delete** — unchanged except the record now echoes `bookStudyId`. The
   one-scroll-per-book invariant (Requirement 1.3) is enforced at create time: before
   creating, query the user's scrolls filtered to this `bookStudyId` (client already knows the
   book's scroll, so the UI blocks it; the Lambda adds a defensive check that returns `409`
   when a scroll already exists for the `bookStudyId`).

### book-study-crud Lambda

No schema change. The detail response already returns everything the hub needs. Optionally the
list/detail can include the linked `scrollStudyId` by a GSI/scan, but to avoid added query
cost the **frontend** resolves the link instead (it already lists scrolls): the Book-detail
page lists the user's scrolls once and finds the one whose `bookStudyId` matches. This keeps
the backend untouched beyond the scroll Lambda.

### Backfill (one-time, idempotent) — `infra/scripts/backfill-scroll-book-link.ts`

A script in the existing `infra/scripts/` seed/guard family (runs under `require.main ===
module`, logic exported for a test). For a given user table scope:

1. Scan `ScrollStudies` for items with empty/absent `bookStudyId`.
2. Group by `(userId, bookName)`. For each group, find a Book Study for that user whose
   `book === bookName` (query the user's book studies); create one if none exists
   (`POST`-equivalent `PutCommand`).
3. Attach the most-recently-updated scroll in the group to that Book Study (`UpdateCommand`
   setting `bookStudyId`); leave extras orphaned with a `console.warn` (A1 allows one scroll
   per book). Never delete.
4. Skip any scroll that already has a `bookStudyId` (re-run safe).

Dev backfill runs as part of this change's verification (dev seed already runs on deploy).
**Prod backfill is a separate maintainer-run invocation**, documented in `delivery.md`, never
automatic — prod holds real data.

## Frontend changes

### `scroll-study.service.ts`
- `ScrollStudy` gains `bookStudyId`; `toScrollStudy` defaults it to `''`.
- `createScrollStudy` input gains `bookStudyId`.

### `BookStudyDetailComponent` — becomes the hub
- Keep book/title/notes/timestamps header.
- Replace the always-expanded Referents form with a **Study Steps** section:
  - Resolve the linked scroll: `ScrollStudyService.listScrollStudies()` once, find the one
    with `bookStudyId === this.bookStudyId`.
  - No scroll → "Upload the scroll (Step 4)" button → `/scroll/new` carrying this
    `bookStudyId` (route gains an optional query param or the upload form reads it).
  - Scroll present → status badge + a step list deep-linking to the existing
    `/scroll/:scrollStudyId/...` routes (Steps 4, 6 pronouns, 6 antecedents, 6 referents, 7,
    8, 9 per Requirement 2.3). Steps 6–9 disabled until `status === 'ready'`.
  - **Referents** step entry opens the existing referent editor (extracted into a referents
    sub-view or a disclosure on the hub), preserving all current logic/validation (Req 4).

### `scroll-upload` / `scroll-view`
- `scroll-upload` reads the incoming `bookStudyId` (query param or router state) and passes it
  to `createScrollStudy`; the book selector is pre-filled/locked to the Book Study's book.
- `scroll-view` adds a "← Back to book study" link routed to `/books/:bookStudyId` when the
  loaded scroll has a `bookStudyId`; omitted for legacy orphans (Req 3.3). The existing step
  buttons stay (Req 3.2).

### Routes
- `/scroll/new` keeps working but now expects a `bookStudyId` context (query param). The
  standalone `/scrolls` list and book-less creation entry points are de-emphasized in nav
  (the Book Studies list becomes the primary home); the routes themselves stay so bookmarks
  and the orphan case keep working.

## CDK / infra

- **No table change.** `bookStudyId` is an item attribute; DynamoDB is schemaless for non-key
  attributes, so no CDK edit is required for the attribute itself.
- The scroll-study Lambda already has read/write on `ScrollStudies`; it now also needs **read**
  on `BookStudies` (to validate the link). Add a least-privilege `grantReadData` from
  `BookStudies` to the scroll-study function. This is the only IAM change; the infra stack test
  SHALL assert the scroll-study function's policy now references `BookStudies` read.
- Table count stays 7, function count stays 9, log-group count unchanged. The stateful guard
  MUST report `✅ No stateful-resource replacement or deletion`.

## Testing strategy

- **scroll-study Lambda test:** create with a valid owned `bookStudyId` persists it and sets
  `bookName` from the book; create with a missing/foreign `bookStudyId` → `400`; create when a
  scroll already exists for the book → `409`; GET echoes `bookStudyId`; legacy record without
  it still returns.
- **backfill test:** orphan scroll links to a matching existing book study; creates a book
  study when none matches; is a no-op on an already-linked scroll; extras for one book are left
  orphaned (not deleted) with a warning.
- **book-study-detail component spec:** renders the steps section; no-scroll shows the upload
  action; linked scroll renders step deep-links; steps 6–9 disabled while not `ready`;
  referent editor still create/edit/remove/saves (relocated, not changed).
- **scroll-view component spec:** back-to-book link present when `bookStudyId` set, absent for
  orphan; existing step buttons still render.
- **infra stack test:** scroll-study function policy references `BookStudies` read; table and
  function counts unchanged (7 / 9).
- **e2e integration spec:** extend the happy path so creating a book → uploading its scroll →
  reaching a step all carry the `bookStudyId` link.

## Risks and tradeoffs

- **Create path becomes book-anchored.** Removing book-less scroll creation is the point (the
  Book is the container), but it means the `/scrolls` standalone list and `/scroll/new` without
  a book are legacy surfaces. Kept functional for the orphan/bookmark case, de-emphasized in
  nav. If the maintainer still wants a book-less quick upload, that is a follow-up.
- **Frontend resolves the scroll↔book link** (lists scrolls, matches `bookStudyId`) rather than
  a backend GSI, to avoid added query cost on a single-maintainer app. If scroll counts grow
  this can become a GSI later; not needed now.
- **Prod backfill is manual.** Correct and deliberate — prod has real data and the backfill
  mutates records. Dev proves the script; the maintainer runs prod when ready.
- **One-scroll-per-book** is enforced at create (UI + defensive `409`). An existing user who
  had two scrolls for one book keeps both as records; backfill links one and warns on the rest.
