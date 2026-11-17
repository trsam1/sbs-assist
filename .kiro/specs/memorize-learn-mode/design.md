# Design: Memorize the Scroll — Learn mode

## Overview

Adds a **Learn** mode to `memorize-view`: a scrolling, verse-by-verse workspace for the chunk the
student is currently learning. It replaces the flip-card layout in Review with the same scrolling
treatment. Everything else (SM-2, new-per-day cap, derived state, reminders, Test-mode grading) is reused.

Backend change is one additive optional field on a chunk, validated by the existing memorization Lambda.
No new resource, route, or dependency.

## Data model

Add to `MemorizationChunk` (frontend `models.ts` and `infra/lambda/shared/models.ts`):

```ts
export interface MemorizationLearnProgress {
  unlocked: number; // verses available to work on, 1..verseCount
  learned: number; // verses checked "Got it", 0..unlocked
  done: boolean; // chunk grade given
}

interface MemorizationChunk {
  // ...existing fields
  learn?: MemorizationLearnProgress; // absent = not started
}
```

Counts and flags only. No verse text. The verse count is not stored; it is derived from the scroll at
render time, so a re-seed that changes the chunk range is handled by clamping (see Edge cases).

### Lambda validation (`infra/lambda/memorization-study/index.ts`)

When `learn` is present: must be an object with `unlocked` and `learned` non-negative integers,
`unlocked >= 1`, `learned <= unlocked`, both `<= VERSES_PER_CHUNK_MAX` (50), and `done` a boolean.
Malformed values are rejected with a 400 like the SM-2 fields. Unknown keys inside `learn` are dropped.
When absent, nothing is stored.

## Pure helpers (`src/app/memorize-view/learn.ts`, unit-tested, no Angular)

```ts
export interface LearnVerse { label: string; text: string }

splitVerses(scrollText, chunk): LearnVerse[]
```
Uses `findVerseMarkers` and the chapter-aware `fullRef` from the chunking work. Verses are the marker
spans inside `[chunk.start, chunk.end)`. If the range has no markers, split on sentence ends
(`. ? !` followed by whitespace); if that yields one unit, return a single verse labelled with the chunk's
`verseRef`.

```ts
rangeText(verses, upTo): string          // verses[0..upTo-1].text joined with a space
initialLearn(): MemorizationLearnProgress // { unlocked: 1, learned: 0, done: false }
clampLearn(learn, verseCount): MemorizationLearnProgress
markLearned(learn): MemorizationLearnProgress   // learned = max(learned, unlocked)
unlockNext(learn, verseCount): MemorizationLearnProgress
isReadyToGrade(learn, verseCount): boolean      // unlocked === verseCount && learned === verseCount
nextChunkToLearn(chunks, derivedStates): number // index, or -1
```

`clampLearn` bounds `unlocked` to `[1, verseCount]`, `learned` to `[0, unlocked]`, and resets
`done` to false when the verse count grew past what was learned.

## Component state (transient, in `memorize-view`)

- `viewMode`: `'learn' | 'review' | 'test' | 'edit'` (adds `'learn'`).
- `learnIndex`: signal, the chunk being learned. Default from `nextChunkToLearn`.
- `learnVerses`: computed from `splitVerses(scrollText, chunks()[learnIndex()])`.
- `learnStage`: signal `'read' | 'fill' | 'recite'`, reset to `'read'` on unlock.
- `learnRevealed`: signal boolean for the Recite stage.
- Fill stage reuses `blankEveryNth` / `firstLetters` with the existing cloze controls.
- Mic: reuses `startRecording`, `stopRecording`, `gradeClip`, and the `testPhase` / `gradeResult` signals
  but with the **range text** as the reference. A `gradeTarget` signal (`'test' | 'learn'`) decides which
  commit path runs after grading: Test commits SM-2; Learn only displays the result (R7.3).
- `reciteDiff` computed already derives from `cardBackText()`. It is generalized to take the reference
  text from the active target (`learn` range text vs. Test card text).

## Persistence

Learn actions mutate `chunks()[learnIndex()].learn` and call the existing `save()` path (same optimistic
update and inline error as grading). No new endpoint. The existing PUT already sends full chunks.

## UI (Learn)

```
[ Learn | Review | Test | Edit ]
Chunk 2 of 7 · 2:6-10        [ Change chunk ▾ ]
3 of 5 verses unlocked  (aria-live)

▸ 2:6  ✓ learned          (collapsed, tap to expand)
▸ 2:7  ✓ learned
▾ 2:8  current            [ Read | Fill | Recite ]
   ...stage content...
🔒 2:9
🔒 2:10

[ Unlock next verse ]  (enabled after Got it, or always with a "not marked learned" hint)
```

Stage content:

- **Read:** verse text, full width, normal wrapping. Button: "Next: Fill".
- **Fill:** cloze of this verse, "Check" reveals the answer inline. Button: "Next: Recite".
- **Recite:** the cumulative range is hidden with a "Reveal" button and (when supported) a mic button.
  After reveal: the range text with missed-word highlight if a mic result exists, then
  "Got it" / "Not yet". "Got it" calls `markLearned`.

Final verse + "Got it" shows the four-button chunk grade (R8) using the existing grade handler. After a
grade, `done = true`, and "Next chunk" calls `nextChunkToLearn`.

Locked and learned states use an icon plus text label, not color alone. No animation is used for stage
changes, which satisfies reduced motion by construction.

## Review reshape

Replace the `.flashcard` 3-D markup with a plain card: reference tag, optional first-letters line,
"Reveal" button, then the full text (`white-space: normal`, wraps) and the four grade buttons. Remove
`flipped`-driven CSS (`flashcard-inner`, `rotateY`, reduced-motion cross-fade) and the swipe-up gesture;
keep Space/Enter-to-reveal, `1 2 3 4`, and swipe-left/right grading. `gestures.ts` loses the flip
classification; its tests are updated. `flip()` is renamed `reveal()` internally; the `flipped` signal
keeps its meaning as "revealed" to limit churn in existing specs.

## Edge cases

- **Re-seed changes a chunk's range:** `clampLearn` bounds the stored counts to the new verse count.
- **Chunk with one verse:** Learn works with `unlocked = 1`; the first "Got it" goes straight to grading.
- **Study with no chunks:** same empty state as Review.
- **Mic unavailable / denied:** mic button hidden; self-check only.
- **Degraded grade (no transcript):** show the plain range text and the existing no-transcript note.
- **Save failure:** keep local state, show the inline error, allow retry (same as grading).
- **Legacy studies:** no `learn` field. Treated as `initialLearn()` when first opened in Learn.
  Chunks already `solid`/`chained` by derived state are skipped by `nextChunkToLearn`.

## Testing

- `learn.spec.ts`: splitVerses (markers, chapters, sentence fallback, single unit), rangeText, clamp,
  unlockNext, markLearned, isReadyToGrade, nextChunkToLearn.
- Component spec: lands in Learn on an in-progress chunk; locked verses collapsed; Read to Fill to
  Recite flow; cumulative range hides 1..N; Got it then Unlock next; no auto-unlock; final grade runs the
  SM-2 path once and sets `done`; mic result in Learn does not call `applyGrade`; Review renders a
  5-verse chunk as wrapped text with no flip classes; keyboard reveal and `1 2 3 4` still grade.
- Lambda test: accepts valid `learn`, rejects bad `unlocked`/`learned`/`done`, round-trips on PUT/GET,
  and a body without `learn` still validates.
- Frontend service spec: the field passes through unchanged.
- `npm run verify` as the gate.

## Rollout and risk

- **Merge order:** one PR. The Lambda change is additive and backward compatible, so an old frontend
  against the new Lambda, and a new frontend against the old Lambda, both work (the old Lambda would drop
  `learn` on save; Learn then falls back to `initialLearn()` on reload until the Lambda deploys).
- **Cost:** the CDK diff is a Lambda code hash and SPA hash rotation. No stateful change. AWS cost is
  unchanged; mic grading in Learn adds Transcribe cost only when the student uses it.
- **Risk: scope.** This is the largest memorize UI change since Review mode. Mitigation: pure helpers
  are tested in isolation, and Review's flip removal is isolated to markup/CSS and `gestures.ts`.
- **Risk: verse splitting on paragraph-seeded chunks** with no markers. Mitigated by the sentence
  fallback and a single-verse degenerate case.

## Build order (for the implementing PR)

1. Model field and Lambda validation with tests.
2. `learn.ts` helpers with tests.
3. Learn mode UI and component specs.
4. Review reshape and flip removal, specs updated.
5. `npm run verify`, PR, watch CI and the CDK diff.
