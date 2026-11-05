# Requirements: Memorize the Scroll — mobile-first flashcard Review mode

## Context and assumptions

Issue #77 asks to **optimize the Memorize the Scroll UI for review**, specifically **mobile-friendly and
near hands-free** interaction — "flashcard style … almost that kind of hands-free" (large targets, minimal
precise tapping, run the daily stack with a thumb). The tool today has everything it needs functionally —
v1 seeding/editing/drill, the v2 SM-2 scheduler with a `dueQueue`/`dueCount` and a four-button grade, and
the v-shipped daily reminder — but the surface is a **dense desktop worksheet**: a single scrolling box of
seed controls, reminder prefs, a per-chunk editor (small ↑ / Merge up / Remove buttons), and the drill
tucked underneath behind a `<select>` chunk picker and small mode toggles. It works with a mouse on a
laptop; on a phone, mid-recitation, it is the opposite of hands-free.

This feature is the first that is purely a **UX reshape of the review loop**. It is **100% frontend**: it
adds a new **Review mode** — a full-bleed flashcard deck driven by the existing due queue — and keeps the
existing worksheet intact as an **Edit mode**. It introduces **no backend, no infrastructure, no new
dependency, and no API/schema change**: it reuses the already-shipped `dueQueue`, `readSchedule`,
`applyGrade`, the existing `grade()`/`save()` persistence path, and the `chunkText`/`firstLetters`
chunking helpers. The v1/v2 data shape is untouched and loads unchanged.

### Confirmed decisions (settled with the user before this draft)

- **D1 — Review mode is ADDITIVE; Edit mode (today's worksheet) is preserved.** A segmented toggle at the
  top of the memorize page switches between **Review** (the new flashcard deck) and **Edit** (the existing
  seed/chunk-editor/drill worksheet, unchanged). Review is the default landing when there is a saved
  study with due chunks; Edit remains the place to seed, re-order, merge, relabel, and set reminder prefs.
- **D2 — the deck is the due queue; grading auto-advances.** Review mode presents **one card at a time**
  drawn from the existing `dueQueue` (soonest-due first, then chunk order). Grading a card runs the
  existing SM-2 `grade()` (which persists via the existing PUT) and **auto-advances** to the next due
  card. When the queue empties, a clear "all caught up" end state is shown.
- **D3 — the card flips; the flip respects reduced motion.** The card shows a **front** (reference label +
  prompt, with an optional first-letters scaffold) and **back** (the full chunk text). A tap/click/Space/
  Enter/swipe-up flips it with a 3-D `rotateY` animation. Under `prefers-reduced-motion: reduce`, the flip
  is replaced by an instant cross-fade (no rotation). The grade buttons appear once the back is revealed.
- **D4 — near-hands-free: large targets + keyboard + swipe.** Grade buttons are full-width, thumb-height
  (≥44px touch targets), bottom-anchored. Keyboard: Space/→/Enter flips; once revealed, `1 2 3 4` grade
  Again/Hard/Good/Easy. Touch: swipe-up flips, swipe-left grades harder (Again), swipe-right grades Easy —
  implemented with plain pointer/touch events, **no gesture library**.
- **D5 — TTS ("read aloud") is explicitly OUT of this spec.** Audio/`SpeechSynthesis` was discussed and
  **deferred to a later V3**. This spec is purely visual/tactile; no audio API is touched.

### Assumptions (flagged for the design review; each the lowest-risk reading of the issue)

- **A1 — Review mode reuses the shipped scheduler surface; it adds no new persistence.** Grading uses the
  existing `applyGrade` + `grade()` + `save()` path; the deck is the existing `dueQueue` computed signal.
  No new signal is persisted; the only new state is transient view state (which card, flipped or not,
  scaffold level). No model, route, Lambda, or table change.
- **A2 — the review deck honors the app-wide copyright invariant.** Card text comes only from the
  student's own `scrollText` (via `chunkText`), exactly as today's drill does; references stay **labels**.
  No verse text is fetched, embedded, or sent anywhere. (TTS, which would *speak* that text, is out — D5.)
- **A3 — Review mode degrades gracefully when there is nothing to review.** With no saved study, or a
  study with zero chunks, Review mode shows an empty state that points at Edit mode to seed. With a study
  whose queue is empty today, it shows the "all caught up / next review falls due…" end state. It never
  blocks access to Edit mode.
- **A4 — the mode toggle and card are fully keyboard- and screen-reader-operable.** The segmented
  Review/Edit toggle, the flip, and the grade buttons are reachable and operable by keyboard with correct
  ARIA (`aria-pressed` on the toggle, a labelled flip control, a labelled grade group, `aria-live` deck
  progress), matching the sibling editors' ARIA patterns. The swipe/keyboard shortcuts are enhancements
  over — never replacements for — the visible, tappable controls.
- **A5 — mobile-first layout without a CSS framework swap.** The redesign stays on **Bulma + inline
  component styles with a media query** (the established convention; see `outline-view`), using CSS
  variables so it themes. No new CSS framework, no Tailwind, no component-library dependency.
- **A6 — no infra, no cost, no stateful surface.** Being frontend-only, the change adds **zero** AWS
  resources; the CDK assertion counts are **unchanged**; the stateful guard stays a no-op; the `diff` job
  shows no resource delta on `WordStudyToolStack` (at most a site-asset bundle rotation, which is not a
  resource change).

---

## Requirement 1: A Review / Edit mode toggle, Review by default for due work

### User Story
As a Bible student on my phone, I want the memorize page to open in a clean review view, so I can run my
due chunks without wading through the seeding and editing controls.

### Acceptance Criteria
1. The memorize page SHALL present a **segmented Review / Edit toggle** at the top of the ready state,
   keyboard-operable with `aria-pressed` reflecting the active mode.
2. **Edit mode SHALL render the existing worksheet unchanged** — the progress summary, due queue, reminder
   preference, seed controls, per-chunk editor, and the existing Chain/Reveal/Fill-blanks drill — with no
   regression to any existing behavior or `data-testid`.
3. **Review mode SHALL be the default** when a saved study exists and has ≥1 chunk; the page MAY default to
   Edit when there is no study yet (nothing to review). The user's explicit toggle choice wins within the
   session.
4. Switching modes SHALL NOT lose unsaved edits or re-fetch the study; both modes read the same `chunks`
   signal.
5. On a narrow (phone) viewport the toggle and both modes SHALL be usable without horizontal scrolling.

---

## Requirement 2: A flashcard deck driven by the due queue

### User Story
As a student doing today's review, I want to see one due chunk at a time as a card I can flip, so I recall
it, check myself, and move on — like flashcards.

### Acceptance Criteria
1. Review mode SHALL present **one card at a time** drawn from the existing `dueQueue` (soonest-due first,
   then chunk order), with a **deck-progress indicator** ("card M of N due") in an `aria-live` region.
2. The card SHALL show a **front** (the chunk's reference label — or "Chunk K" when unlabeled — plus a
   recall prompt) and, after a flip, a **back** showing the full chunk text from the student's scroll.
3. The card SHALL offer an optional **first-letters scaffold** on the front (reusing `firstLetters`) that
   the student can toggle, so they can self-prompt before flipping.
4. Grading the card (Requirement 3) SHALL **auto-advance** to the next card in the deck; the previously
   graded card SHALL leave the deck for the session (it is no longer due after a pass; an Again re-queues
   it to the end so it comes back within the session).
5. When the deck is **empty** (no due chunks today), Review mode SHALL show a clear **all-caught-up end
   state** naming when the next review falls due, mirroring the existing due-queue empty copy.
6. All card text SHALL come **only** from the student's own `scrollText` via `chunkText`; references remain
   labels; **no verse text** is fetched or transmitted.

---

## Requirement 3: Flip + four-button grade, large and near hands-free

### User Story
As a student reviewing on my phone one-handed, I want big buttons and simple gestures, so I can flip and
grade with a thumb and barely look away from reciting.

### Acceptance Criteria
1. The card SHALL **flip** (front↔back) on tap/click anywhere on the card, on Space / Enter / →, and on a
   **swipe-up** gesture. The flip SHALL use a 3-D `rotateY` transition; under
   `prefers-reduced-motion: reduce` it SHALL instead cross-fade with no rotation.
2. Once the back is revealed, the card SHALL present the four grade actions **Again / Hard / Good / Easy**
   as **full-width, thumb-height (≥44px) buttons**, bottom-anchored on narrow viewports.
3. Grading SHALL be operable by: tapping the button, pressing `1 2 3 4` (Again/Hard/Good/Easy), or
   **swiping left (Again) / right (Easy)**. The visible buttons SHALL always be present; the
   keyboard/swipe shortcuts are additive enhancements.
4. Grading SHALL call the existing SM-2 `grade()` path (updating only the scheduling fields, never the
   learned `state`) and persist via the existing save, then auto-advance (Requirement 2.4).
5. The available keyboard/gesture shortcuts SHALL be shown on-screen (a brief, dismissible legend) so the
   hands-free controls are discoverable; the legend SHALL be screen-reader accessible.
6. While a grade save is in flight, the grade controls MAY disable to prevent a double-submit, consistent
   with the existing `saving()` guard; a save failure SHALL keep the card's updated schedule in memory and
   surface the existing inline save-error affordance.

---

## Requirement 4: Mobile-first, accessible, zero-infra

### User Story
As the maintainer, I want the review redesign to be a clean frontend change that themes correctly, works
on a phone, and adds no infrastructure, so it ships safely with no stateful risk.

### Acceptance Criteria
1. The redesign SHALL be **frontend-only**: no new Lambda, route, DynamoDB change, EventBridge, SES, or
   StageConfig value, and **no new runtime dependency**. The CDK assertion counts SHALL be **unchanged**
   and the stateful guard SHALL remain a no-op.
2. The card and controls SHALL be styled with **Bulma + inline component `styles` using a media query and
   CSS variables** (the established convention), rendering correctly in both light and dark theme and on a
   narrow (≤480px) viewport.
3. The flip animation SHALL honor `prefers-reduced-motion: reduce` (cross-fade, no rotation) and SHALL not
   trap or disorient keyboard/screen-reader users.
4. The mode toggle, flip control, grade group, and deck progress SHALL be keyboard-operable and
   screen-reader labelled, matching the sibling components' ARIA patterns.
5. All new behavior (mode toggle, deck advance, flip state, grade mapping, empty/end states, keyboard and
   gesture handlers) SHALL be covered by frontend tests under the existing TestBed/vitest harness; the SM-2
   math SHALL continue to be exercised through the existing `srs` helper and the `grade()` path (no new
   persistence to test).

---

## Non-Functional Requirements

1. **Frontend conformance.** Change is confined to `memorize-view.component.ts` (template, inline styles,
   class) and its spec, plus — if a shared gesture/keyboard helper is extracted — a small sibling pure
   module next to `srs.ts`/`chunking.ts` with its own `*.spec.ts`. No backend, no infra, no new dependency.
2. **Additive & non-regressive.** Edit mode preserves every existing `data-testid` and behavior; the v1
   drill and v2 scheduler/grade and the reminder toggle all remain reachable. Existing memorize-view tests
   stay green.
3. **Copyright policy.** Card text comes only from the student's own scroll; references stay labels; no
   verse text is fetched, embedded, or transmitted. (TTS is out of scope — D5.)
4. **Accessibility.** Keyboard operable end-to-end; correct ARIA on the toggle, flip, grade group, and
   deck progress; honors reduced motion; visible controls never depend on gesture/keyboard shortcuts.
5. **Mobile-first.** Usable one-handed on a ≤480px viewport: large bottom-anchored targets, no horizontal
   scroll, no hover-only affordance.
6. **Cost & infra.** Zero AWS resources added; CDK counts unchanged; stateful guard clean; `diff` shows no
   `WordStudyToolStack` resource delta.
7. **No AWS/Bedrock in tests.** Frontend-only; the component tests run under the existing TestBed harness
   with the service stubbed, as the current memorize-view spec does.

---

## Out of Scope

- **Text-to-speech / "read aloud" / any audio** — explicitly deferred to a later V3 (D5).
- **Any backend, infra, route, Lambda, table, or StageConfig change** — the feature is frontend-only.
- **Changing the SM-2 algorithm, the grade→quality mapping, or the learned-`state` ladder** — Review mode
  drives the *existing* scheduler; the two axes stay orthogonal exactly as shipped.
- **A new charting/animation/gesture library or a CSS-framework swap** — plain Bulma + inline styles +
  native pointer/touch and keyboard events only.
- **Offline/PWA, service worker, or installable-app behavior** — a possible later increment, not here.
- **Persisting review-session state** (which card, deck order) across reloads — the deck is recomputed
  from the due queue each visit; transient view state is not saved.
- **Any change** to the v1 seeding/editing drill behaviors beyond relocating them under the Edit toggle,
  or to any shipped Step 4–12 tool or route.

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
