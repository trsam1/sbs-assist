# Requirements: Search and export a book's study work

## Context and assumptions

A student's work on one book is spread across many tools: notes and referents on the book, word studies,
antecedents, structure, outline, theme and purpose, figures, interrogation, and memorization. There is no
way to find "where did I write about the Spirit?" and no way to take the work out of the app. This spec adds
both, **per book**, using only data the app already stores.

### Confirmed decisions

- **D1 — Per-book search first.** The unit of study is the book, and its data is already one click away on
  Book home.
- **D2 — Export is a document the student can read and keep** (Markdown), plus a JSON backup of the same
  content. Both are generated in the browser and never uploaded.
- **D3 — No backend, table or IAM change.** Everything is read through the existing GET endpoints.

### Assumptions (flagged for review)

- **A1 — The scroll text is the student's own upload**, so it may be searched and exported, but it is large.
  Searching it is a checkbox (default on), and exporting it is a checkbox (default off).
- **A2 — Memorization stores chunk offsets and reference labels, not verse text.** Export and search use
  the reference labels, progress state and due dates, never text sliced from the scroll.
- **A3 — Search is plain, case-insensitive, accent-insensitive substring matching** with all words required.
  No stemming and no fuzzy matching in this version.
- **A4 — Import is out of scope.** The JSON file is a backup the student can keep and read; restoring it is a
  later spec if wanted.
- **A5 — AI summaries in word studies are exported with an "AI summary" label**, so they are never mistaken
  for the student's own words.
- **A6 — "Search everything across all books" is not built.** It would need every book's data loaded.
  Instead, the Books list gets a cheap search over book names, titles, notes, and word studies.

## Requirement 1: Search within a book

1. **R1.1** Book home has a "Search this book" box. The first search loads the book's work once (see
   Requirement 3) and keeps it for the visit; later searches are instant.
2. **R1.2** A query is split into words; a result must contain all of them, ignoring case and accents.
3. **R1.3** Results are grouped by where they live: Book notes, Referents, Word studies, Antecedents,
   Structure, Outline and theme, Figures, Interrogation, Memorization labels, and Scroll text.
4. **R1.4** Each result shows a short snippet with the matched words highlighted and the field it came from
   (for example "Interrogation › answer"), and links to the page where it can be edited.
5. **R1.5** At most 25 results per group are shown, with "N more" counted. The total is announced to screen
   readers.
6. **R1.6** A "Search scroll text" checkbox (default on) includes the scroll; scroll results show the
   surrounding line, and link to the scroll page.
7. **R1.7** If part of the data cannot be loaded, the search still runs on the rest and says which parts were
   unavailable.
8. **R1.8** Clearing the box clears the results. No query is stored or sent anywhere.

## Requirement 2: Export a book

1. **R2.1** Book home has an "Export" control with two choices: a Markdown document and a JSON backup.
2. **R2.2** Options: "Include scroll text" (default off), "Include word studies" (default on).
3. **R2.3** The Markdown document is organized by the method's steps, in order, with the book name and title
   as the heading and the export date. Empty steps are left out. Planned and manual steps are not listed.
4. **R2.4** Each section contains the student's entries in readable form: for example figures as
   "Reference, type, text, interpretation, notes"; outline as the nested I / A / 1 / a outline with titles
   and main ideas; interrogation as questions with answers grouped by category.
5. **R2.5** Memorization appears as a table of reference label, progress state, and next due date. No verse
   text is included unless "Include scroll text" is on, and even then only as the whole scroll text in its
   own section, never sliced chunks.
6. **R2.6** The JSON backup has `format: "axios-book-export"`, a `version` number, `exportedAt`, and one
   key per source (book, scroll metadata, word studies, antecedents, structure, outline, figures,
   interrogation, memorization), each exactly as the app stores it. It never contains user ids or the
   student's email.
7. **R2.7** A part that fails to load is listed in a "Not included" note at the top of the Markdown and in an
   `unavailable` array in the JSON, so a partial export is never mistaken for a complete one.
8. **R2.8** The file is downloaded by the browser with a name like `romans-study-2026-11-17.md`. Nothing is
   uploaded.
9. **R2.9** Markdown special characters in the student's text are escaped so headings, lists and tables in
   the document are only the ones the exporter makes.

## Requirement 3: Loading a book's work

1. **R3.1** One `BookBundleService` loads, in parallel, the scroll study (already known from Book home),
   the word studies linked to the book, and the antecedent, structure, outline, figures, interrogation and
   memorization studies for that scroll, plus the book itself (notes and referents).
2. **R3.2** Each part reports `loaded`, `empty` (404 or no entries), or `failed`. Empty is normal and is not
   an error.
3. **R3.3** The bundle is cached for the visit to Book home and discarded when the student leaves. Saving
   elsewhere never leaves stale data because the cache does not outlive the page.
4. **R3.4** Loading shows a progress message and does not block the rest of the page.

## Requirement 4: Books list search

1. **R4.1** The Books list gets a search box that filters books by name, title or notes, and also lists word
   studies whose word, Strong's number or notes match, each linking to the study.
2. **R4.2** It uses data the list page already loads or can load with one call. No per-book calls.

## Requirement 5: Non-functional

1. **R5.1** Frontend only. CDK diff shows SPA asset-hash rotation only; the stateful guard stays clean.
2. **R5.2** Search ranking, snippet building, Markdown rendering, JSON shape, escaping, and file naming are
   pure functions with unit tests. Download is a thin wrapper tests replace. No test calls AWS.
3. **R5.3** Accessibility: the search box is a labeled `search` landmark, results are a list of links with a
   live count, highlights use `<mark>` (not color alone), the export control is keyboard operable.
4. **R5.4** Large books: searching is synchronous over in-memory strings and must stay responsive for a
   350 KB scroll; the scroll is searched line by line rather than as one string with context windows built
   per match.
5. **R5.5** The work lands as two PRs: (1) bundle service, export, and the Export control; (2) search on
   Book home and the Books list search.

## Out of scope

- Importing or restoring from the JSON file.
- Searching across all books at once, full-text indexing, stemming, or fuzzy matching.
- Exporting word studies on their own from the word study list, PDF output, or printing styles.
- Sharing, publishing, or syncing exports anywhere.
