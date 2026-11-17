# Requirements: Memorize the Scroll — Learn mode (verse-by-verse, student-paced)

## Context and assumptions

Review mode (spec `memorize-review-mode`) is a flip-card deck built for **recalling a chunk you already
know**. It fits that job poorly for **learning a new chunk**. The student's actual method is:
5-verse chunks, each learned over about a week, roughly **one new verse a day**, at their own pace, with
the SM-2 scheduler still deciding when finished chunks come back.

The flip card squeezes a 5-verse chunk into one centered paragraph on a fixed-shape card, and it treats
the chunk as a single unit graded once. There is no way to work on verse 3 while keeping verses 1 and 2
warm, and no sense of "where am I in this chunk".

This feature adds a **Learn mode**: a scrolling, verse-by-verse workspace for the one chunk the student is
currently learning. It reuses the shipped scheduler, chunking helpers, cloze helpers, Test-mode grading
pipeline, and the `reciteDiff` missed-word highlight (PR #89). It is **not** a rewrite of the scheduler.

### Confirmed decisions (settled with the user)

- **D1 — Learn is a new mode beside Review / Test / Edit.** The toggle becomes Learn · Review · Test ·
  Edit. Learn is the default landing when a chunk is in progress.
- **D2 — Manual pace.** The student unlocks the next verse by tapping "I've got it". There is no
  date-driven plan and no automatic unlock.
- **D3 — Cumulative build.** The Recite step for verse N covers verses 1..N joined, so earlier verses
  never go stale.
- **D4 — Mic recitation is available in Learn.** It reuses the async `grade-start` / `grade-status`
  pipeline and the missed-word highlight. Self-check (no mic) is always available.
- **D5 — Review mode's flip card is retired.** Review becomes the same scrolling layout, reading the due
  queue. The flip-card component, 3-D CSS, and swipe-to-flip gestures are removed.
- **D6 — SM-2 is unchanged.** One grade for the whole chunk, given when the last verse is chained,
  feeds the existing `applyGrade`.

### Assumptions (flagged for review)

- **A1 — Learn progress is persisted on the chunk**, so it follows the student between phone and desktop.
  This needs one additive optional field and a matching Lambda validation rule (see design.md). It is the
  only backend change. localStorage was rejected because Learn is the mode used across devices.
- **A2 — "The chunk being learned"** is the first chunk whose derived state is `new` or `learning` and
  whose Learn progress is incomplete, unless the student picked another. The student can switch chunk.
- **A3 — Verse boundaries come from the scroll's verse markers** inside the chunk's range
  (`findVerseMarkers`). A chunk with no markers (paragraph-seeded) is treated as sentence-split verses; if
  that yields one unit, Learn still works with a single "verse".
- **A4 — Copyright invariant holds.** Text comes only from the student's own `scrollText` via
  `chunkText`. No verse text is persisted: the new field stores counts and flags only.
- **A5 — Mobile first.** Learn must be fully usable at 360px width with a 5-verse chunk, with no
  fixed-height card, no horizontal scroll, and tap targets of at least 44px.

## Requirements

### R1 — Mode toggle and landing

1. The mode toggle offers Learn, Review, Test, Edit, each with `aria-pressed`.
2. On load, if any chunk has incomplete Learn progress, the page opens in Learn on that chunk. Otherwise
   it opens in Review when cards are due, and in Edit when there are no chunks (existing behavior).
3. Existing studies load unchanged. Chunks with no Learn field are treated as not started.

### R2 — Chunk picker

1. Learn shows the current chunk's reference label and a "Chunk N of M" indicator.
2. A control lets the student choose a different chunk. Only that chunk's Learn state changes.
3. A chunk already fully learned shows a "Learned" badge and offers "Relearn", which resets its Learn
   progress but not its SM-2 schedule.

### R3 — Verse list layout

1. The current chunk's verses render as a normal vertical list in readable text, each with its verse
   label (for example `2:6`). Text wraps and the page scrolls; nothing is clipped or fixed-height.
2. Verses not yet unlocked are shown collapsed as a label plus a lock indicator, not hidden, so the
   student sees the whole shape of the chunk.
3. The unlocked count and total are announced in an `aria-live` region ("3 of 5 verses unlocked").

### R4 — Per-verse stages

For the newest unlocked verse, the student moves through three stages in order, with the ability to go
back:

1. **Read.** The verse is shown in full.
2. **Fill.** The verse is shown with blanks (every Nth word, or first letters), using the existing cloze
   helpers. The student fills or checks mentally and taps "Check" to reveal.
3. **Recite.** The verse (cumulative range, see R5) is hidden. The student recites, then reveals.

Earlier verses are shown in full, collapsed by default, and can be expanded to re-read.

### R5 — Cumulative recite

1. The Recite stage for verse N hides and tests verses 1..N joined in order.
2. On reveal, the full range is shown with the self-check controls from R6.
3. Verse 1's Recite stage covers verse 1 alone.

### R6 — Check and unlock

1. After revealing, the student can self-check ("Got it" / "Not yet") or record with the mic (R7).
2. "Got it" on the newest unlocked verse marks it **learned** and enables "Unlock next verse". Unlocking
   is always an explicit tap; it never happens automatically.
3. "Not yet" leaves the verse unlearned and returns to Read or Fill (student's choice).
4. The student may unlock the next verse early without marking the current one learned. The UI makes the
   state visible but does not block it (the student sets the pace).

### R7 — Mic recitation in Learn

1. Learn offers the same "Start reciting / Done reciting" control as Test, available in the Recite stage,
   when `recordingSupported()` is true.
2. The recording is graded through the existing async pipeline against the cumulative range text.
3. The result shows the missed-word highlight and "You said" line (`reciteDiff`). The grade value and
   accuracy are shown, but a mic result in Learn **never writes the SM-2 schedule**. Only the final
   chunk grade (R8) does.
4. Where recording is unsupported or denied, the mic control is hidden and self-check remains.

### R8 — Finishing a chunk

1. When the last verse is unlocked and its cumulative recite is checked "Got it", Learn offers a
   **chunk grade** (Again / Hard / Good / Easy) using the existing grade buttons.
2. Grading runs the existing `applyGrade` and `save()` path, marks the chunk **learned** in Learn
   progress, and offers "Next chunk".
3. The "Again" behavior setting (redo now / later) does not apply in Learn. Again returns the chunk to
   its first unlocked verse's Recite stage.

### R9 — Persistence

1. Learn progress is saved with the study through the existing PUT, debounced with the same save
   guard as other edits, and shows the existing inline error on failure while keeping local state.
2. The stored data is counts and flags only: `unlocked` (integer, 1..verse count) and `learned`
   (integer, 0..verse count) plus a `done` flag. No verse text is stored.
3. The server validates the new field when present and rejects malformed values. Absent means not
   started.

### R10 — Review mode reshape

1. Review mode shows the due card as a scrolling card: reference label, a hidden or first-letters
   body, a "Reveal" button, then the full text and the four grade buttons. No flip animation.
2. The text wraps and scrolls; a 5-verse chunk renders without clipping at 360px.
3. Keyboard shortcuts stay: Space/Enter reveals, then `1 2 3 4` grades. Swipe-left Again / swipe-right
   Easy stay as enhancements. Swipe-up-to-flip is removed.
4. The new-chunks-per-day cap, derived state ladder, and Again setting are unchanged.

### R11 — Accessibility

1. Verse stages and the unlock control are keyboard-operable with visible focus.
2. Locked, learned, and current verses are distinguishable without color alone (icon or text).
3. Reduced-motion users get no animated transitions in Learn or Review.

### R12 — Non-functional

1. Frontend plus one additive Lambda validation rule and shared model field. No new AWS resource, no
   new dependency, no new route. The stateful guard stays a no-op.
2. `npm run verify` passes. New pure helpers have unit tests; component behavior has spec coverage.
3. The audio-coaching (SpeechSynthesis) feature and the Step 5 cloze follow-up stay out of scope.

## Out of scope

- Text-to-speech or audio coaching loops.
- Date-driven or automatic verse unlocking.
- Any change to SM-2 math, the new-per-day cap, or the daily reminder.
- Storing or fetching verse text anywhere other than the student's own scroll.
