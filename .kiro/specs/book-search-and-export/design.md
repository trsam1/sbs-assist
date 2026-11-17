# Design: Search and export a book's study work

## Overview

Frontend only. One service loads everything a book has into a **bundle**; three pure modules turn the bundle
into search results, a Markdown document, and a JSON backup; thin UI on Book home and the Books list drives
them.

```
src/app/book-bundle/
  book-bundle.service.ts     loads the parts in parallel, per-part status
  book-bundle.ts             types + pure helpers (empty detection, strip ids)
  book-search.ts             pure: build entries, query, snippets
  book-export.ts             pure: toMarkdown, toJson, fileName, escapeMd
  download.ts                thin Blob download wrapper (replaced in tests)
  book-search.component.ts   search box + grouped results (Book home)
  book-export.component.ts   Export control (Book home)
```

## Bundle

```ts
type PartStatus = 'loaded' | 'empty' | 'failed';
interface Part<T> { status: PartStatus; data: T | null }

interface BookBundle {
  book: BookStudy;                       // already loaded by Book home
  scroll: Part<ScrollStudy>;
  wordStudies: Part<StudyWorksheet[]>;   // linked to this book
  antecedents: Part<AntecedentStudy>;
  structure: Part<StructureStudy>;
  outline: Part<OutlineStudy>;
  figures: Part<FiguresStudy>;
  interrogation: Part<InterrogationStudy>;
  memorization: Part<MemorizationStudy>;
}
```

`BookBundleService.load(book, scrollStudyId | null)` runs the existing GETs in one `forkJoin`, each wrapped
like `toStatus` in `step-list/step-status.service.ts`: a result is `loaded` (or `empty` when it has no
entries), a 404 is `empty`, any other error is `failed`. No scroll means the scroll-based parts are `empty`
without calling. It reuses the same service methods Book home and the tool pages already call, so no new
endpoint and no IAM change.

The word studies come from `StudyCrudService.listStudies()` filtered by `bookStudyIds` (the same filter Book
home uses). The scroll comes from `ScrollStudyService.getScrollStudy(id)`.

The bundle is held in a signal on `BookStudyDetailComponent`, created on the first search or export and
dropped with the component (R3.3). Nothing is written to storage.

## Search (`book-search.ts`)

### Entries

`buildEntries(bundle, { includeScroll })` flattens the bundle into
`SearchEntry { group, field, text, link, ref? }` rows, one per searchable string:

| Group | Source fields |
| --- | --- |
| Book notes | title, notes |
| Referents | phrase, refersTo, notes, scrollRef |
| Word studies | word, Strong's number, definition notes, Strong's notes, lexicon notes, notes, cross-reference notes, AI summary |
| Antecedents | antecedent, pronoun, type |
| Structure | genre, tone, marker phrase/ref/notes, section label/refs/notes, element, secondary genre notes |
| Outline and theme | theme, purpose, paragraph main idea/notes, grouping title/notes |
| Figures | reference, text, interpretation, notes, other label |
| Interrogation | question, answer, passage reference, notes, tags |
| Memorization | reference label only (never chunk text) |
| Scroll text | one entry per non-empty line |

`link` is the route the field is edited at (`/study/:id`, `/scroll/:id/outline`, and so on, from the step
catalog), so a result always opens the right page.

### Query

`normalize(s)`: lower-case, NFD, strip combining marks, collapse whitespace. `search(entries, query)` splits the
normalized query on spaces (empty query returns no results), keeps entries whose normalized text contains
every word, and returns them grouped, capped at 25 per group with `{ shown, total }`.

### Snippets

`snippet(text, words, width = 80)` finds the first match, returns up to `width` characters of context each
side with ellipses, and a list of `[start, end]` ranges to wrap in `<mark>`. Highlight ranges are computed on
the normalized string and mapped back to the original by keeping a per-character index map during
normalization (so accented text highlights correctly). The component renders segments, never `innerHTML`.

### Performance (R5.4)

The scroll is split into lines once when the entries are built (cached per bundle). Each search does a
substring test per entry; 350 KB is a few thousand lines, which is well under a frame. If a query is typed
quickly, the component debounces by 150 ms.

## Export (`book-export.ts`)

All pure, taking the bundle and options and returning strings.

### Markdown

`toMarkdown(bundle, { includeScroll, includeWordStudies, now })`:

1. `# {book} — {title}` and `Exported {date}`.
2. If any part failed: a "Not included" list naming each failed part (R2.7).
3. Sections in method order, each skipped when empty: Notes, Step 4 Scroll (only when `includeScroll`, whole
   text in a fenced block), Step 5 Word studies, Step 6 Antecedents and Referents, Step 7 Structure, Step 8
   Outline, Step 9 Theme and purpose, Step 10 Figures, Step 12 Interrogation, Memorize.
4. Outline renders nested I / A / 1 / a using the existing `outline-number.ts` numbering.
5. Interrogation groups by category; figures by group (parallelism, figure); antecedents as a table of
   occurrence, pronoun, type, antecedent; memorization as a table of label, state, due date.
6. `escapeMd(text)` escapes `\ ` * _ [ ] # > |` and leading list or heading markers per line, and replaces
   newlines inside table cells with `<br>`. Scroll text is placed in a fence long enough that it cannot be
   closed by the text itself.

### JSON

`toJson(bundle, options)` returns `JSON.stringify(payload, null, 2)` where:

```ts
{ format: 'axios-book-export', version: 1, exportedAt, unavailable: string[],
  book, scroll?, wordStudies?, antecedents?, structure?, outline?, figures?, interrogation?, memorization? }
```

`stripIdentity` removes `userId` (and `GSI*`, `PK`, `SK` if ever present) from every object before
serializing (R2.6). The scroll is included without `scrollText` unless `includeScroll`.

### File name and download

`fileName(book, ext, now)`: lower-case, non-alphanumerics to hyphens, trimmed, plus the ISO date, for example
`romans-study-2026-11-17.md`. `download.ts` creates a `Blob`, an object URL and a temporary anchor with
`download`, clicks it, and revokes the URL. Tests replace it with a spy.

## UI

- **Book home:** `app-book-search` below the step list header: a `role="search"` form with a labeled input, a
  "Search scroll text" checkbox, and a results region (`aria-live="polite"`, count announced). Results are
  grouped `<details open>` lists; each item is a link with `<mark>`ed snippet and a small "field" label.
  Loading shows "Loading this book's work…" once, and a "Some parts could not be loaded: …" note when needed.
- **Export:** `app-book-export` is a small dropdown with "Download document (.md)" and "Download backup
  (.json)", plus the two option checkboxes. It loads the bundle if needed, then calls the pure function and
  `download`. A failure to build shows an inline error; a partial bundle still downloads with the "Not
  included" note.
- **Books list:** the page gets a search input that filters the list it already has, and, when the query is
  non-empty, calls `StudyCrudService.listStudies()` once (cached for the visit) and lists matching word
  studies (word, Strong's number, notes) below the books, each linking to the study.

## Edge cases

- Book with no scroll: scroll-based parts are `empty`; search and export still cover notes, referents and
  word studies.
- Everything empty: the export still downloads a short document ("No work recorded yet").
- A very long note or scroll line: snippets are windowed, never the whole text.
- Text containing Markdown or HTML: escaped on export; rendered as plain text, never HTML, in results.
- Duplicate results for the same string are not possible: one entry per field.
- Memorization labels only: a search for a verse word will not match chunk text, which is not stored.

## Testing

- `book-search.spec.ts`: normalization, accent folding, all-words matching, grouping and caps, snippet and
  highlight ranges with accents, scroll lines, empty query, memorization labels only.
- `book-export.spec.ts`: Markdown for each section, empty-step skipping, outline numbering, escaping
  (headings, tables, fences), "Not included" note, options, JSON shape and identity stripping, file name.
- `book-bundle.service.spec.ts`: loaded, empty (404) and failed per part; no scroll means no scroll-based
  calls; word studies filtered by book.
- Component specs: search box results and live count, partial-failure note, export control calls the
  download spy with the right name and type; Books list search. Services are stubbed per the standing rule.
- No test calls AWS or triggers a real download.

## Rollout and risk

- CDK diff: SPA asset hash only; the stateful guard is clean. No stored data changes.
- Loading a whole book is about eight GETs, on demand only. The one existing cost it highlights: the
  scroll list call Book home already makes returns every scroll's full text. The bundle uses the single
  scroll GET instead, and Book home's existing list call can be slimmed in a later cleanup if it ever feels
  slow.
- Risk of a lossy export: mitigated by the "Not included" and `unavailable` markers and by tests that build a
  document from every part.

## Build order

PR 1: `book-bundle` types and service, `book-export.ts` with tests, `download.ts`, the Export control on Book
home.
PR 2: `book-search.ts` with tests, the search component on Book home, and the Books list search.
