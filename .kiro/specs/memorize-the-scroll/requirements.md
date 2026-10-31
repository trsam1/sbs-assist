# Requirements: Memorize the Scroll (Memorization companion — v1)

## Context and assumptions

Issue #63 asks for a **Memorization companion** tool: while working a study, a student also wants to
**memorize the book (its scroll text)**. This is a new tool on the shipped **Book / Scroll hub**, and
unlike Steps 4–16 it is **not one of the method's 17 numbered steps** — it is a *discipline alongside*
the steps (memorizing a book in scroll form is a recognized practice in this inductive tradition, and
is arguably the deepest form of "observe the text"). It stays inside the product's three commitments:
it **assists** the student's own memorization effort (chunks, drills, tracks progress) and does **not**
do the memorizing for them.

The method's own stance on chapter/verse grounds the design (Step 7 reference,
`docs/references/inductive-study-step-7.md`): *"The chapter and verse numbers in our Bibles… are
convenient for reference, but they are not inspired… the student must read the text itself and let the
author's own signals set the divisions."* So the tool treats **verse references as reference anchors
that are kept** (present in the scroll text, shown but visually de-emphasised — the user confirmed the
scroll keeps them, just not formatted to stand out) and **paragraphs as the author's-flow unit** the
student actually reads, tests, and chains.

The student's personal method, which v1 serves directly: **chunk-and-chain, verse by verse, tested in
paragraphs** — learn a verse, chain it onto the accumulated run, and recite the whole paragraph when it
is whole. Progressive-reveal and blank-word cloze are alternate drill modes over the same chunks for
different learning styles.

### What the tool is (and is NOT)

- It **is**: a worksheet that reads the student's own **persisted scroll text**, lets the student mark
  **chunk boundaries** (paragraph-level, each optionally labelled with a kept verse reference), tracks
  **per-chunk learned-state** that survives sessions, and drives three **drill modes** over those
  chunks (chunk-and-chain, progressive reveal, blank-word cloze).
- It is **NOT**: a source of Bible verse text (it reads only the scroll the student already uploaded),
  an AI tool (**no Bedrock call anywhere**), or a scheduler. A spaced-repetition "what's due today"
  scheduler and audio modes are explicitly **v2/v3**, out of scope here.

### The two axes of a chunk (decided with the user)

A single "verse number" field would conflate two different things the method keeps distinct:

- **Verse reference** — *a reference anchor*. Kept in/alongside the text so a chunk can be located and
  labelled ("2:5–8"); shown de-emphasised. It is a free-text **label**, not a parser-enforced key, and
  it is **location only** — never verse text.
- **Paragraph (the chunk)** — *the author's-flow unit*. This is the real boundary the student reads,
  tests, and chains. The student sets these boundaries (seeded best-guess, then editable), honouring
  the method's "let the student set the divisions."

### Assumptions (flagged for the design review; each the lowest-risk reading of the issue)

- **A1 — new tool, hub-folded, mirrors the sibling CRUD step views.** A new `MemorizationStudies`
  table + a `MemorizationStudyFn` CRUD Lambda (copying `interrogation-study`/`structure-study`), one
  record per `(scrollStudyId, userId)`, reached from the Book hub as "Memorize the Scroll", gated on a
  `ready` scroll. New lazy route `scroll/:scrollStudyId/memorize`.
- **A2 — no AI, no new verse-text source.** No Bedrock call, no `StageConfig` field, no second Lambda.
  The tool reads the existing `ScrollStudyRecord.scrollText` (served once `status === 'ready'`); it
  serves, embeds, and stores **no** Bible verse text of its own — the scroll is the student's own
  upload.
- **A3 — chunk boundaries persist.** The student marks paragraph chunks once (seeded best-guess split,
  then editable); the boundaries and per-chunk learned-state persist so chunk-and-chain progress sticks
  across sessions. This is the core reason the tool is persisted rather than ephemeral.
- **A4 — chunks are character offsets into the scroll text, not copies of it.** A chunk stores a
  `start`/`end` offset pair into the current `scrollText` plus an optional `verseRef` label and
  learned-state — **it does not copy the text**. The view slices `scrollText` by offset to render a
  chunk, so no verse text is duplicated into the memorization record. (Robustness of offsets against a
  re-uploaded scroll is handled in the design; v1 assumes the scroll text is stable once `ready`.)
- **A5 — per-chunk learned-state.** Each chunk carries a `state` ∈ `{new, learning, chained, solid}`
  the student advances as they drill it; it persists and is the substrate the v2 scheduler will read.
- **A6 — three drill modes, student-chosen per session, no persistence of a "session".** `chain`
  (reveal chunk N, recite, then recite the accumulated run), `reveal` (full → first-letters → blank,
  tunable), `cloze` (hide every Nth word, or hide the study's Step 5 key words where present; typed =
  auto-graded, or reveal = self-graded). The mode is a view-only choice; only chunk boundaries and
  learned-state persist.
- **A7 — ordered, student-authored, re-seedable.** The student can re-seed the best-guess split, and
  add / split / merge / relabel / reorder chunks; order is preserved as saved; a scroll with zero
  chunks is valid (shows the seed action).

---

## Requirement 1: Define and persist chunk boundaries over the scroll

### User Story
As a Bible student memorizing a book, I want to break the scroll into the paragraph chunks I memorize,
labelled by verse reference, so I can learn it verse-by-verse and recite it paragraph-by-paragraph.

### Acceptance Criteria
1. WHEN the student opens the tool on a `ready` scroll with no saved memorization study THEN the system
   SHALL offer to **seed** a best-guess chunking of `scrollText` (split on blank-line / paragraph
   boundaries, detecting leading verse markers such as `1 `, `2 ` where present and using them as chunk
   labels), producing an ordered list of editable chunks.
2. Each **chunk** SHALL carry: a `start` and `end` character offset into `scrollText` (`0 ≤ start <
   end ≤ scrollText.length`); an optional `verseRef` label (free text, ≤ 50, **location only, never
   verse text**); and a learned-`state` (see Requirement 3).
3. The student SHALL be able to **re-seed**, **add**, **split**, **merge**, **relabel**, **reorder**,
   and **remove** chunks; order SHALL be preserved as saved.
4. The system SHALL persist exactly one **Memorization Study** per `(scrollStudyId, userId)` holding
   the ordered chunk list, via `GET`/`PUT /scroll-studies/{scrollStudyId}/memorize`, keyed like the
   sibling studies (`PK = USER#<sub>`, `SK = MEMORIZE#<scrollStudyId>`).
5. A chunk SHALL store **offsets, not text** — the memorization record SHALL NOT copy any slice of
   `scrollText`; the view slices the scroll by offset at render time. The feature SHALL serve, embed,
   or store **no** Bible verse text of its own.
6. An empty chunk list SHALL be valid and SHALL save (presenting the seed action on next open).

---

## Requirement 2: Drill a chunk in a chosen mode

### User Story
As a Bible student, I want to drill a chunk in the style that suits me — chaining, progressive reveal,
or fill-in-the-blank — so I can memorize it the way I learn best.

### Acceptance Criteria
1. The view SHALL offer three drill **modes**, selectable per session (not persisted):
   - **chain** — reveal chunk N's text, let the student recite, then reveal the **accumulated run**
     (chunk N chained with its learned predecessors in order) for a paragraph-level recitation.
   - **reveal** — show the chunk at a reveal level the student steps through: **full text → first
     letter of each word → blank**, and back; the level is a view control, not persisted.
   - **cloze** — hide words in the chunk: every *N*th word (student-chosen N), or the study's **Step 5
     key words** where a Word Study exists for the book (hidden where they appear); the student
     **types** the missing words (auto-checked against the scroll slice) **or** reveals to self-grade.
2. Every drill mode SHALL render chunk text by slicing `scrollText` at the chunk's offsets — no verse
   text is read from the memorization record.
3. The verse reference label SHALL be shown **de-emphasised** beside a chunk (small/muted), reflecting
   the method's "kept for reference, not the structure"; the paragraph text is the focus.
4. Switching modes SHALL NOT alter chunk boundaries or learned-state; a mode is a view concern only.
5. Cloze typed-answer checking SHALL compare normalised text (case-insensitive, punctuation-tolerant)
   and SHALL run entirely client-side — **no AI, no server call** for grading.

---

## Requirement 3: Track per-chunk learned progress

### User Story
As a Bible student, I want the app to remember which chunks I've learned and chained, so I can pick up
where I left off instead of starting over each session.

### Acceptance Criteria
1. Each chunk SHALL carry a learned-`state` ∈ `{new, learning, chained, solid}`.
2. The student SHALL be able to advance or reset a chunk's `state` from the drill UI; the change SHALL
   persist on save (`PUT`), so progress survives closing and reopening the app.
3. The view SHALL summarise progress (e.g. "7 of 23 chunks solid") from the persisted states.
4. `state` SHALL be validated server-side against the fixed set (a value outside it → `400`).
5. **Out of scope for v1:** *scheduling* which chunk is **due** (spaced repetition) and any daily
   nudge — the states are the substrate a later v2 scheduler will read, but v1 neither computes due
   dates nor sends reminders.

---

## Requirement 4: Reach the tool from the Book hub, gated on a ready scroll

### User Story
As a Bible student, I want to open the memorization tool from my book's hub once the scroll is ready,
so it lives with the rest of my work on that book.

### Acceptance Criteria
1. The tool SHALL be reached from the Book hub as **"Memorize the Scroll"**, placed as a companion
   entry (not numbered among Steps 4–16), active only when the scroll is `ready`.
2. The `uploading`/`extracting` states SHALL show a "preparing" message with a back link; `failed`/404
   SHALL show an explanatory message with a back link — the same state model as the sibling views.
3. The route SHALL be a new lazy `scroll/:scrollStudyId/memorize` → `memorize-view`, under
   `/scroll-studies/...` so the existing `user-id.interceptor.ts` already matches it (no interceptor
   change).

---

## Requirement 5: Validate the memorization study server-side

### User Story
As the maintainer, I want the server to validate the memorization study, so a malformed client cannot
persist bad data or oversized items.

### Acceptance Criteria
1. `chunks` SHALL be an optional array on the `PUT` body (absent → stored `[]`); order preserved.
2. Each chunk SHALL be validated: `start` and `end` non-negative integers with `start < end`;
   `verseRef` a string ≤ 50; `state` ∈ `{new,learning,chained,solid}`. A bad item → `400` with a
   message, the student's values kept client-side.
3. The chunk array SHALL be capped (≤ 2000 chunks — ample for any book at verse granularity) to bound
   item size; over the cap → `400`.
4. The server SHALL NOT fetch or validate `scrollText` against the offsets on write (the scroll is a
   separate record owned by its own Lambda); offsets are stored as given and sliced client-side on
   read. (Design notes the stale-offset risk and the v1 stability assumption.)
5. Validation SHALL follow the existing handlers' `parsePutBody` approach (JSON-parse in `try/catch`,
   reject non-objects/`null` → `400`). `userId` SHALL be taken only from the Cognito `sub` claim; any
   body `userId` SHALL be ignored.

---

## Non-Functional Requirements

1. **Stack conformance.** Frontend SHALL use Angular 21 standalone components with signals and Bulma,
   in a new `memorize-view` component. Backend SHALL be a new `MemorizationStudyFn` CRUD Lambda + the
   shared models + a new `MemorizationStudies` table, mirroring `interrogation-study`/`structure-study`
   — **no AI, no second Lambda, no `StageConfig` field**.
2. **Auth and scoping.** The route requires the Cognito authorizer and derives `userId` from the token
   `sub`; `user-id.interceptor.ts` already matches `/scroll-studies/...` so no interceptor change.
3. **Copyright policy.** The feature serves/embeds/stores **no** Bible verse text: it reads the
   student's own `scrollText` by offset and stores only offsets + labels + states; `verseRef` is a
   student-typed location only. No Bedrock call is introduced.
4. **Additive infra.** A new table + function, both additive; `removalPolicy` =
   `config.statefulRemovalPolicy` (`Retain` in prod), no GSI, no PITR. The stateful guard stays clean
   (new protected resource, allowed). Counts: tables 9 → 10, functions 12 → 13, function log-groups
   13 → 14.
5. **Cost.** One on-demand table + one small CRUD Lambda; no Bedrock. Negligible, and $0 when dev is
   destroyed.
6. **Accessibility.** The chunk editor, drill controls, reveal-level stepper, cloze inputs, and
   progress summary SHALL be keyboard operable and screen-reader labelled, matching the sibling
   editors' ARIA patterns; drill animations (reveal transitions) SHALL respect reduced-motion.
7. **No test calls AWS or Bedrock.** Covered by the mocked-DynamoDB Lambda tests and the
   `memorize-view` component tests under the existing no-AWS harness.

---

## Out of Scope

- **Spaced-repetition scheduling and reminders (v2)** — computing which chunk is *due*, SM-2 intervals,
  and any daily "N chunks due" nudge. v1 persists the learned-states that v2 will schedule over, and
  nothing more.
- **Audio (v3)** — text-to-speech listen-mode and speech-to-text recitation self-check.
- **Any AI / Bedrock call** — no AI-suggested chunking, no AI grading. (Also keeps the tool clear of
  the open Step 10 Bedrock bug, #58.)
- **Fetching, embedding, or serving any Bible verse text** — the tool reads only the student's own
  persisted scroll, by offset.
- **Re-anchoring chunks after a scroll re-upload** — v1 assumes `scrollText` is stable once `ready`;
  robustly re-mapping offsets when a student re-uploads a different scroll is a later increment (the
  design notes the detection seam).
- **A dedicated navbar surface** — reached from the Book hub.
- **Any change** to the shipped Step 4–12 tools, the Word Study, or their routes (v1 *reads* a Word
  Study's key words for the optional cloze mode but does not modify it).

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
