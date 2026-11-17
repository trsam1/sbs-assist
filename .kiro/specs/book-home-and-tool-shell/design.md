# Design: Book home and a shared tool shell

## Overview

Frontend only. Three new pieces replace duplicated code, then the pages that use them are converted.

```
steps.ts                      single step catalog (pure data + helpers)
tool-shell/
  scroll-tool-context.ts      component-provided service: loads the scroll study once
  tool-shell.component.ts     header, breadcrumb, state panels, prev/next step links
book-study-detail/            becomes Book home (step list with statuses)
app.ts, app.routes.ts         navbar and route changes
```

## Step catalog (`steps.ts`)

```ts
export type FitTag = 'shipped' | 'planned' | 'candidate' | 'manual';
export interface StepDef {
  id: string;          // 'scroll' | 'pronouns' | 'antecedents' | 'structure' | 'outline' | ...
  number: number | null;
  name: string;
  route: string | null; // suffix under /scroll/:id, '' for the scroll itself, null for no page
  fit: FitTag;
  blurb: string;
  needsScroll: boolean;
}
export const STEPS: readonly StepDef[];
export const COMPANION_TOOLS: readonly StepDef[];   // Memorize
export function scrollSteps(): StepDef[];           // shipped + route != null, in method order
export function neighbours(id: string): { prev: StepDef | null; next: StepDef | null };
```

- Step 6 appears once per page: Pronouns and Antecedents are separate rows (two routes); Referents stays a
  panel on Book home, as today.
- Step 9 has `route: 'outline'` and a fragment `#theme`, so the outline page scrolls to its theme panel.
- Manual steps carry `route: null`.
- Unit tests: order, no duplicate ids, every `route` is registered in `app.routes.ts` (a test reads the
  route config), `neighbours` at the ends.

## ScrollToolContext

```ts
@Injectable()   // provided per page: providers: [ScrollToolContext]
export class ScrollToolContext {
  readonly study = signal<ScrollStudy | null>(null);
  readonly state = signal<'loading'|'ready'|'preparing'|'failed'|'error'>('loading');
  readonly scrollText = computed(() => this.study()?.scrollText ?? '');
  init(scrollStudyId: string): void;   // starts the load
  retry(): void;
}
```

- Same state machine the pages use today: 404 and `status === 'failed'` give `failed`; other HTTP errors
  give `error`; a non-ready, non-failed status gives `preparing`.
- Pages call `ctx.init(id)` in `ngOnInit`, then react to `ctx.state() === 'ready'` with an `effect` or a
  `computed` to load their own saved study. Their `load()`/`failedMessage()` code is deleted.
- The memorize page does extra work on ready (reminder prefs, seeding). It keeps that, triggered by the
  ready state.

## ToolShell

```html
<app-tool-shell stepId="figures" [ctx]="ctx">
  <!-- projected: the page's ready-state content -->
</app-tool-shell>
```

- Inputs: `stepId` (catalog id), `ctx`. Reads the book name from `ctx.study()`; if the study has a
  `bookStudyId`, the first crumb links to `/books/:id`; otherwise to `/scrolls` (A3).
- Template: breadcrumb `<nav aria-label="Breadcrumb">`, an `h2` with `Book — Step N Name`, prev and next
  links from `neighbours(stepId)` (hidden when the scroll isn't ready), then a `@switch (ctx.state())`:
  `loading`, `preparing`, `failed`, `error` panels, and `<ng-content/>` for `ready`.
- The panels reuse the wording from today's pages. One test-id set: `tool-loading`, `tool-preparing`,
  `tool-failed`, `tool-error`, `tool-retry`, `tool-crumb-book`, `tool-prev`, `tool-next`.
- `OnPush`, signals only. No HTTP of its own.

### Conversion order (PR 1)

Smallest page first so the pattern settles before the big ones: figures, interrogate, antecedents, pronouns,
structure, outline, memorize. For each: provide `ScrollToolContext`, wrap the ready content in the shell,
delete the page's own loading/failed/preparing/error markup and `load()`/`failedMessage()`, update its spec.
Each page keeps its own `data-testid`s for tool content.

## Book home (PR 2)

- `BookStudyDetailComponent` keeps its form, delete and referents behavior. The "Study steps" section is
  replaced by a list built from `STEPS` and `COMPANION_TOOLS`.
- **Status:** a `BookStepStatusService.load(scrollStudyId)` runs the six existing GETs in parallel
  (antecedents, structure, outline, figures, interrogation, memorization). Per call: a saved study gives
  `in-progress`, a 404 gives `not-started`, any other error gives `unknown`. The list renders immediately
  with `unknown` shown as a muted dash, then fills in. Pronouns have no saved study of their own, so they
  show no status.
- **Row:** `Step N — Name`, a fit tag for non-shipped steps, a status tag, and a link when shipped and
  the scroll is ready. Manual steps read "Pencil and paper" with the catalog blurb.
- **Memorize row:** shows "N due" when the memorization study loads and has chunks due, using the same
  `dueQueue` helper the page uses (extracted to a pure function if it is not already one).
- **No scroll yet:** one prominent "Upload the scroll (Step 4)" card, then the rest listed but disabled.

## Scroll page and navbar

- `scroll-view` replaces its three buttons with the same step list component (a shared
  `StepListComponent` taking the scroll id and optional statuses), plus a link to its book.
- Navbar: brand "Axios Bible Study Tools" linking to `/books`; items Books and Word Studies; account menu
  unchanged. The mobile burger behavior stays.
- Routes: `{ path: '', redirectTo: 'books', pathMatch: 'full' }` and a `studies` route for the word study
  list. Internal links to `/` for word studies change to `/studies`.

## Edge cases

- Scroll with no book link: breadcrumb falls back to Scrolls; Book home is unreachable from it, which is
  today's behavior.
- A status call is slow or fails: that row shows unknown, others are unaffected; the page never blocks.
- Scroll still processing: shell shows `preparing` with a link back to the book; Book home shows later steps
  disabled with the existing explanation.
- Deep link to a tool with a bad scroll id: `failed` panel with a link to Books.
- Reduced motion, screen readers: no animation is added; panels keep `aria-live`.

## Testing

- `steps.spec.ts`: catalog integrity and route registration.
- `scroll-tool-context.spec.ts`: each state transition with a stubbed `ScrollStudyService`.
- `tool-shell.component.spec.ts`: crumb target with and without a book, each panel, prev/next, retry.
- Each converted page spec: shell present, ready content renders, old duplicated assertions removed or moved
  to the shell spec.
- `book-step-status.service.spec.ts`: mix of 200, 404, and 500 gives in-progress, not-started, unknown.
- Book home and scroll page specs for the step list; navbar spec for the new items.
- New injected services get a stub in each affected spec (standing rule).

## Rollout and risk

- CDK diff: SPA asset-hash rotation only; stateful guard clean (R5.1).
- Biggest risk is a regression in a converted page's loading path. Mitigation: convert one page per commit,
  keep its existing content tests, and run the full suite after each.
- `/` redirecting to `/books` changes the landing page. Word studies stay one click away and at `/studies`.
- Dev deploys on merge; prod waits for the usual approval. Neither PR touches stored data.

## Build order

PR 1: `steps.ts` + tests; `ScrollToolContext` + tests; `ToolShell` + tests; convert pages in the order
above.
PR 2: `StepListComponent`, `BookStepStatusService`, Book home, scroll page, navbar, routes.
