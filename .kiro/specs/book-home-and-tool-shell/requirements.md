# Requirements: Book home and a shared tool shell

## Context and assumptions

An audit of the app (2026-11-17) found that the Book Study is meant to be the container for a student's
work on a book (spec `link-studies-to-book`), but the app still presents three parallel roots in the
navbar (Word Studies, Scroll Studies, Book Studies) and six tool pages that each re-implement the same
load, failed, preparing, saving and back-link code. Specific problems:

- The scroll page links only Steps 6 to 8; the book page links nine steps. The lists drifted apart.
- Every tool page's back link goes to the scroll list or the scroll page, never to the book.
- "Step 9" opens the Step 8 page; "Memorize the Scroll" has no step number; Steps 3, 11, 13, 14, 16 have
  no visible place.
- `load`, `loadSaved`, `save`, `failedMessage` and the failed/preparing/error panels exist six times.

This spec fixes navigation and removes the duplication. It is **frontend only**: no Lambda, table, or
infra change.

### Confirmed decisions

- **D1 — The book page is the home for a book's work** ("Book home"). The navbar leads to it.
- **D2 — One step catalog** is the single source for step numbers, names, routes, and software-fit tags.
- **D3 — One shared tool shell** gives every tool page the same header, breadcrumb, state panels, and
  step switcher.

### Assumptions (flagged for review)

- **A1 — Word studies stay a separate list for now.** Linking a word study to a book is a separate spec
  (it needs an additive field). The navbar keeps a "Word Studies" entry.
- **A2 — Step status on Book home is derived from existing data**, by asking each step's existing GET
  endpoint whether a saved study exists (404 means not started). No new endpoint. A status that cannot be
  read shows as unknown, never as an error banner.
- **A3 — Legacy scrolls with no `bookStudyId`** keep working: their tool pages render with a "Scrolls"
  breadcrumb instead of a book.
- **A4 — No existing route stops working.** `/` now redirects to `/books`; the word study list is also
  served at `/studies`. All other routes are unchanged, so bookmarks keep working.

## Requirement 1: Step catalog

1. **R1.1** One module, `src/app/steps.ts`, lists the 17 steps with: number, name, route suffix (or none),
   software-fit tag (`shipped | planned | candidate | manual`), and a short description.
2. **R1.2** The Memorize tool appears in the catalog as a companion tool, not as a numbered method step.
3. **R1.3** Step 9 is listed as "Theme and Purpose" and routes to the outline page's theme section.
4. **R1.4** Book home, the scroll page, and the shell's step switcher all read the catalog. No other file
   hard-codes a step list.

## Requirement 2: Shared tool shell

1. **R2.1** A `ToolShell` component wraps every scroll-based tool page (antecedents, pronouns, structure,
   outline, figures, interrogate, memorize).
2. **R2.2** It shows a breadcrumb: `Book name › Step N — Name`. The book crumb links to Book home; for a
   legacy scroll it links to the scroll list.
3. **R2.3** It owns the loading, preparing, failed, and error panels, with one wording and one retry
   button. Tool pages render only their ready state.
4. **R2.4** It shows previous and next step links among the shipped scroll-based steps, so the student can
   move through the method without going back to a list.
5. **R2.5** A shared `ScrollToolContext` (component-provided service) loads the scroll study once and
   exposes `study`, `scrollText`, `state`, and `retry()`. Each tool page's duplicate load code is removed.
6. **R2.6** Every page keeps its existing `data-testid` values for its own content. Shell-owned panels use
   a single set of test ids, and specs are updated to match.
7. **R2.7** Behavior of each tool's own saving and editing is unchanged.

## Requirement 3: Book home

1. **R3.1** `/books/:id` shows the book name and notes, then a list of all 17 steps from the catalog.
2. **R3.2** Each shipped step shows a status: Not started, In progress (saved work exists), or Unknown.
   "Done" is not claimed, because the method has no objective completion test.
3. **R3.3** Each shipped step links to its page. Planned and candidate steps show their fit tag and no
   link. Manual steps (1, 2, 15, 17) are shown as pencil-and-paper steps.
4. **R3.4** Before a scroll exists, only Step 4 (upload) is actionable; later steps explain that they
   read from the scroll, as today.
5. **R3.5** Memorize shows its own summary line (chunks learned and due) when memorization data exists.
6. **R3.6** Status loading is non-blocking: the page renders at once and statuses fill in.

## Requirement 4: Navigation

1. **R4.1** The navbar becomes: Books (home), Word Studies, and the account menu. "New Word Study", "New
   Scroll Study", and "Scroll Studies" leave the navbar; creating them stays one click away on their list
   pages and on Book home.
2. **R4.2** The brand reads "Axios Bible Study Tools" (matching the target domain), not "Bible Word Study
   Tool".
3. **R4.3** The scroll page shows the same step list as Book home (from the catalog) instead of its own
   three links, and links back to its book.
4. **R4.4** `/` redirects to `/books`. The word study list is served at `/studies` and linked from the
   navbar. Links inside the app that pointed at `/` for word studies are updated.

## Requirement 5: Non-functional

1. **R5.1** CDK diff shows only SPA asset-hash rotation; the stateful guard is clean.
2. **R5.2** Step catalog, context loading, and status derivation are unit-tested without Angular where
   possible. No test calls AWS.
3. **R5.3** Accessibility: breadcrumb uses `nav` with `aria-label="Breadcrumb"`; panels keep `role` and
   `aria-live`; the step list is a real list with link text that names the step.
4. **R5.4** The work lands as two PRs: (1) catalog, shell, context, and converted tool pages; (2) Book
   home, scroll page, and navbar.

## Out of scope

- Linking word studies to a book, search, export and backup, splitting `memorize-view` (separate specs).
- New study tools.
- Any change to stored data, API shapes, or routes.
