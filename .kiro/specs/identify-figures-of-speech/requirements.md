# Requirements: Identify Figures of Speech (Step 10 — Figures Study)

## Context and assumptions

Issue #53 asks for a **Figures Study** tool for inductive-study **Step 10 — Identify Figures of
Speech**, the first **Interpretation**-phase step (Steps 4–9, the Observation phase, are shipped).
Step 10 is where the student, having observed the book's structure and outline, begins to interpret
it by naming the *kinds of language* in play — distinguishing literal from figurative, tagging
figures of speech (metaphor, metonymy, hyperbole, irony, personification, …) and the Hebrew-poetry
**parallelism** forms (synonymous, antithetic, synthetic, statement-and-comment, emblematic) — and
recording what each one means and why. Naming a figure and stating its sense is interpretive work
the student must do; the method is explicit that *context decides*, that one interprets literal
language literally and figurative figuratively, and the governing caution *"if the first sense
makes sense, don't look for another sense."* Software's role here is to **surface candidates to
consider, teach the categories, and give a second opinion on the student's own call** — never to
classify or interpret on the student's behalf.

Like the shipped Step 6–9 tools, this tool reads from the student's **Scroll Study** (Step 4) and
is reached from the **Book Study hub** that now groups all step work under a book (see
`.kiro/specs/link-studies-to-book/`). It persists one **Figures Study** record per scroll per user,
keyed by `scrollStudyId`, exactly as the Antecedent/Structure/Outline studies are. It is the first
tool to combine the shipped persisted-worksheet pattern with the **on-demand Amazon Bedrock assist**
pattern already shipped in Step 5's AI summary (`.kiro/specs/word-study-tool/`), used here in a
**consultant** role, never a grader.

### What the method puts under Step 10 (from the persisted course reference)

- **Parallelism** (Hebrew poetry; Lowth's categories): synonymous, antithetic, synthetic,
  statement-and-comment, emblematic.
- **Figures of speech**: allegory, allusion, apostrophe, climax, ellipsis, euphemism, hyperbole,
  irony/sarcasm, litotes, metaphor, metonymy, parable, personification, anthropomorphism, typology.
- **Governing principles the tool surfaces but never decides:** interpret literal literally and
  figurative figuratively; *"if the first sense makes sense, don't look for another sense"*; context
  decides; symbolism illustrates but does not prove doctrine; no hidden "codes."

### Assumptions (flagged for the design review; each the lowest-risk reading of the issue)

- **A1 — one combined tool for parallelism *and* figures.** The method lists both under one step,
  and tagging "this is antithetic parallelism" and "this is a metaphor" is the same student action
  (tag a passage with a type + the sense + why). One `FiguresStudy` record with one `figureType`
  taxonomy covers both, the taxonomy grouped into a `parallelism` group and a `figure` group so a
  later split (if ever wanted) is a filter, not a migration (locked with the user).
- **A2 — keyed by `scrollStudyId`, reached from the Book hub.** One Figures Study per
  `(scrollStudyId, userId)`, fetched by exact key and upserted on save — identical to
  `AntecedentStudies`/`StructureStudies`/`OutlineStudies`, so **no GSI**. The view is reached from
  the Book Study hub's step list as "Step 10 — Figures of Speech," gated until the scroll is
  `ready`, the same contextual navigation the other step views use. No top-level navbar surface.
- **A3 — the student authors every entry; AI only assists on demand.** Each figure entry's
  `figureType`, `text`, and `interpretation` are **student-authored**. The three AI actions
  (Requirement 3) are **on-demand buttons** that *surface candidates*, *explain a category*, and
  *check the student's chosen type against a passage* — none of them writes a field; the student
  accepts, edits, or ignores every AI output. This mirrors Step 5, the method's one deliberately
  assisted step, where the AI synthesizes *the student's own notes*.
- **A4 — the "explain a category" help is canned glossary text, not an AI call.** The taxonomy is
  fixed and a definition of "metonymy" does not need a live model, so category explanations are a
  client-owned glossary constant (free, deterministic, always available). Only the two actions that
  genuinely need *the student's own text* — candidate scan and tag-check — call Bedrock (locked
  with the user).
- **A5 — text sent to AI is the student's own, under the current copyright rule.** The governing
  product rule is now **"Student Provided Bible text — the app can use Bible text as long as the
  student provided it"** (`product.md`, Guiding constraints). The scroll text is the student's own
  uploaded document and any passage the student types is their own entry, so sending either to
  Bedrock is permitted. The app still never *serves, fetches, or embeds* Bible text the student did
  not provide — the canned glossary contains **no scripture quotations**, and there is no
  server-side verse lookup.
- **A6 — one focused tool for one step; changes nothing earlier.** This increment delivers only
  Step 10 and does not alter the Step 4–9 tools, the Book hub's existing step entries, or the Word
  Study (Out of Scope). It adds one step entry to the hub and one additive route.
- **A7 — the assist model is a per-stage config value, no UI picker (locked with the user).** Because
  candidate-spotting and tag-checking are judgment tasks (not Step 5's synthesis), the assist runs a
  stronger tier than Haiku, set per stage in `stage-config.ts` as `figuresAssistModelId` — **prod
  Claude Opus 5.5, dev Claude Sonnet 5.5** — so the live student gets the strongest model while dev
  is a one-tier-down evaluation surface. There is no student-facing model picker and no runtime
  model-selection plumbing; promoting the eventual winner is a one-line `stage-config.ts` edit. Model
  access for both ids is available on the account.

---

## Requirement 1: Open a Figures Study for a ready scroll from the Book hub

### User Story
As a Bible student, I want to open the Figures Study for a book I am studying, so that I can tag and
interpret the figures of speech and parallelism in its text.

### Acceptance Criteria
1. WHEN the student opens the Figures Study view for a Scroll Study whose status is `ready` THEN the
   system SHALL load the scroll's `scrollText`, load any previously saved Figures Study for that
   `scrollStudyId` (via `GET`), and present the worksheet (Requirements 2–3).
2. WHEN no Figures Study has been saved yet for that scroll THEN the system SHALL present an empty
   but editable worksheet (no error): an empty figure-entry list and the assist actions available.
3. WHEN the referenced Scroll Study status is `uploading` or `extracting` THEN the system SHALL show
   a non-blocking "the scroll text is still being prepared" message with a back link to the scroll
   view (`/scroll/:scrollStudyId`), consistent with the structure/antecedent views, and SHALL NOT
   call any AI action.
4. WHEN the referenced Scroll Study status is `failed`, or the study does not exist or is not owned
   by the user (API `404`) THEN the system SHALL show an explanatory message and a back link, and
   SHALL NOT analyze.
5. The Figures Study step entry SHALL appear in the **Book Study hub** step list (Step 10), gated to
   active only when the book's scroll is `ready`, matching how Steps 6–9 are gated there.
6. A student SHALL only ever load their own scroll and their own Figures Study; cross-user access
   SHALL be impossible (the API returns `404` for a scroll or record the Cognito `sub` does not
   own — the same trust boundary as the scroll/antecedent/structure paths).

---

## Requirement 2: Tag and interpret figure entries (parallelism + figures of speech)

### User Story
As a Bible student, I want to record each figure of speech or parallelism I find, with its type, the
passage, and what I think it means, so that I capture my interpretive work on the book's language.

### Acceptance Criteria
1. The system SHALL let the student add a **figure entry** with: a `figureType` from a fixed,
   client-owned taxonomy (Requirement 2a), a `reference` (free-text location, e.g. "2:6–11", "the
   hymn"; **location only**), an optional `text` (the student's own transcription or paraphrase of
   the passage, in their words — optional, since they may cite the location only), an
   `interpretation` (free text — what the student judges it means), and optional `notes`.
2. The system SHALL present the taxonomy grouped into **Parallelism** (synonymous, antithetic,
   synthetic, statement-and-comment, emblematic) and **Figures of speech** (allegory, allusion,
   apostrophe, climax, ellipsis, euphemism, hyperbole, irony/sarcasm, litotes, metaphor, metonymy,
   parable, personification, anthropomorphism, typology), plus an `other` type with a free-text
   label, so the two method groupings live in one worksheet.
3. The student SHALL be able to edit, reorder, and remove figure entries before and after saving;
   order SHALL be preserved as saved.
4. `figureType`, `text`, and `interpretation` SHALL be **student-authored** — no AI action writes
   them directly (Requirement 3 governs assistance). `reference` and `figureType` are required per
   entry; `text`, `interpretation`, and `notes` are optional (empty stored as `""`).
5. The worksheet SHALL carry a one-line reminder of the governing caution — interpret figurative
   language as figurative but *"if the first sense makes sense, don't look for another sense"*, and
   that symbolism illustrates rather than proves — drawn from the Step 10 reference (no scripture
   text).

### Requirement 2a: The figure taxonomy is a fixed client-owned list
1. The taxonomy SHALL be a fixed, client-owned TypeScript constant (the single source of truth for
   the picker, server validation values, the glossary keys, and the tests), grouped
   `parallelism` / `figure`, each type carrying a stable id, a display name, and the group tag.
2. Adding `other` with a student label SHALL be supported for a figure the taxonomy does not name.
3. The grouping tag SHALL be stored per entry (derivable from the type) so a later optional split of
   parallelism vs. figures into separate views is a filter over the same records, not a migration.

---

## Requirement 3: On-demand AI assist — candidates, category help, tag check (consultant, not grader)

### User Story
As a Bible student — especially a first-timer who does not yet know all the categories — I want
optional help spotting likely figures, understanding what each category means, and sanity-checking a
type I have chosen, so that the tool guides me without making my interpretive calls for me.

### Acceptance Criteria

**3.1 — Suggest candidates (AI, on demand).**
1. The system SHALL provide a **"Suggest candidates"** button that, when pressed, sends the
   student's own scroll text (and, where helpful, their existing notes) to the AI assist endpoint
   and returns a list of **candidate passages** that *may* contain a figure, each with a
   **location**, a **suggested type to consider**, and a **one-line reason to look there**.
2. Candidates SHALL be **advisory only**: pressing the button creates **no** figure entries. The
   student MAY turn a candidate into an entry (pre-filling `reference` and the suggested
   `figureType`, both still editable) or dismiss it.
3. The suggestion output SHALL NOT contain a filled-in `interpretation` — it surfaces *where to
   look and what kind to consider*, never the sense of the passage.
4. The action SHALL be user-initiated only (never automatic/background), and SHALL degrade
   gracefully: on an AI error or empty result the system SHALL show a recoverable inline message and
   SHALL NOT block manual tagging.

**3.2 — Explain a category (canned glossary, no AI call).**
1. The system SHALL provide an **"Explain"** affordance on each taxonomy type that shows a short,
   plain-language definition of that figure/parallelism type, with a brief generic illustration (no
   scripture quotation), to orient a student who does not yet know the term.
2. These explanations SHALL be a **client-owned glossary constant** (deterministic, offline, no
   Bedrock call), keyed by the taxonomy type id, covering every type in Requirement 2a.
3. The glossary text SHALL contain **no copyrighted scripture quotations** — definitions and generic
   examples only.

**3.3 — Check my tag (AI, on demand).**
1. The system SHALL provide a **"Check this tag"** button on a figure entry that sends the entry's
   `figureType`, its `reference`, and the student's own `text` (their transcription/paraphrase, if
   provided) to the AI assist endpoint and returns an **opinionated second read**: whether the
   chosen type seems to fit, and if not, which type it reads more like and *why*, phrased as a
   consultant's suggestion the student is free to overrule.
2. The check SHALL **never change** the entry's `figureType` or any field automatically — it returns
   advice the student reads; the student alone edits the entry.
3. The response SHALL make the student the decider in its own wording (it advises, it does not rule),
   consistent with "assist, never replace."
4. The action SHALL be user-initiated only and SHALL degrade gracefully on an AI error (recoverable
   inline message; the entry and all fields are preserved).

**3.4 — AI boundary (applies to 3.1 and 3.3).**
1. The AI SHALL be invoked **only** by an explicit student button press — no analysis runs on load,
   save, or in the background.
2. The AI output SHALL never be written into `figureType`, `text`, or `interpretation` without the
   student's explicit accept/edit action.
3. Prompts SHALL contain only the student's own provided text (scroll text and/or the student's own
   entry fields) and the fixed taxonomy — never app-fetched or app-embedded Bible text (A5).
4. The persisted Figures Study SHALL store **only student-authored fields** — no AI response text is
   persisted as the student's interpretation (an AI second-read is transient UI, not saved as the
   student's work).

---

## Requirement 4: Persist and resume a Figures Study

### User Story
As a Bible student, I want my Figures Study saved so I can close the app and return to it later.

### Acceptance Criteria
1. The system SHALL persist a Figures Study scoped to one `scrollStudyId` and one authenticated
   user, with fields: `scrollStudyId`, `userId` (Cognito `sub`), `entries` (ordered list of figure
   entries per Requirement 2), `createdAt`, and `updatedAt` (ISO 8601).
2. The "Save" action SHALL `PUT` the Figures Study and reflect the saved state on success
   (timestamps updated); a student MAY save repeatedly.
3. WHEN the student reopens the view for a scroll with a saved Figures Study THEN the system SHALL
   `GET` and render exactly the saved `entries` in order.
4. The server SHALL set `userId` from the Cognito `sub` claim and SHALL ignore any `userId` in the
   request body (same hardening as the sibling CRUD Lambdas).
5. There SHALL be at most one Figures Study per `(scrollStudyId, userId)` pair; saving again updates
   the same record (upsert), mirroring the antecedent/structure/outline records.
6. IF a save fails THEN the system SHALL keep the student's entered values and show an inline error
   with retry; IF a load fails on a transient/5xx error THEN the system SHALL show a recoverable
   error state with Retry, distinct from the terminal `404` not-found state.

---

## Non-Functional Requirements

1. **Stack conformance.** Frontend SHALL use Angular 21 standalone components with signals and Bulma,
   consistent with `structure-view`/`outline-view`. Backend SHALL be serverless (Lambda + API
   Gateway + DynamoDB) via CDK: one new `FiguresStudies` table and **two** new Lambdas — a
   `FiguresStudyFn` CRUD (mirroring `StructureStudyFn`) and a thin `FiguresAssistFn` Bedrock function
   (mirroring the shipped `AISummaryFn`) — keeping AI prompts isolated and independently testable.
2. **Auth and scoping.** All Figures Study and Figures Assist routes SHALL require the Cognito
   authorizer and derive `userId` from the token `sub`, never from client input.
3. **Copyright policy (updated rule).** Per `product.md`'s **"Student Provided Bible text"**
   constraint, the scroll text and the student's own typed passages MAY be sent to the AI assist;
   the app SHALL NOT fetch, embed, or serve any Bible text the student did not provide, and the
   canned glossary SHALL contain no scripture quotations.
4. **AI usage posture.** All Bedrock calls SHALL be user-initiated only (no automatic/background
   invocation), reuse the Step 5 **graceful-degrade error pattern and `InvokeModel` shape**, and add
   no always-on resources. The assist model is a **per-stage `StageConfig` value** —
   `figuresAssistModelId`, prod **Claude Opus 5.5** and dev **Claude Sonnet 5.5** (a stronger tier
   than Step 5's Haiku, because figure candidate-spotting and tag-checking are judgment tasks) — wired
   into both the Lambda's `MODEL_ID` env and its Bedrock IAM grant so the two never drift. There is
   **no** student-facing model picker. The category glossary uses no AI.
5. **Cost.** Persistence reuses DynamoDB on-demand billing (negligible). Bedrock is the only variable
   cost and remains user-initiated and bounded (short `max_tokens`). The assist runs a stronger,
   costlier tier than Step 5 (Opus/Sonnet vs. Haiku) — a deliberate trade for a low-traffic judgment
   step — so per-call cost is higher but total cost stays small and variable (few, short, on-demand
   calls); no test or smoke step calls Bedrock. A cheaper tier can be adopted later via a one-line
   `stage-config.ts` change.
6. **Accessibility.** New UI SHALL be keyboard operable and screen-reader labeled, matching existing
   ARIA patterns (`aria-label`, `aria-live` for AI results, `aria-pressed`, `role="alertdialog"` for
   destructive confirms, `is-sr-only`).
7. **No test calls AWS or Bedrock.** The assist Lambda's Bedrock client SHALL be mocked in tests
   (`infra/test/setup-no-aws.ts`); no AWS endpoint is hit at test time.

---

## Out of Scope

- **AI classification or interpretation of the student's text** — the AI surfaces candidates,
  explains categories, and gives a second opinion; it never writes `figureType`, `text`, or
  `interpretation`, and nothing runs without a button press. The student makes every interpretive
  call.
- **Splitting parallelism and figures into two separate tools** — one combined worksheet now; the
  taxonomy's group tag keeps a later split cheap (a filter), but the split itself is not built here.
- **Persisting AI second-read text** as part of the study — AI advice is transient UI only.
- **Fetching, embedding, or serving any Bible text the student did not provide**, including canned
  scripture in the glossary or a server-side verse/concordance lookup.
- **The later Interpretation steps** (11 Genre, 12 Interrogate, 13 Cross-references, 14 Paraphrase)
  and Application steps — each a separate later tool on the same hub pattern.
- **Any change** to the Step 4–9 tools, the Word Study, or the `WordStudies`/`/studies` routes.
- **A top-level "Figures Studies" navbar surface** — reached from the Book hub step list, like the
  other step views.
- **Non-English scroll text** in the candidate scan (the taxonomy and glossary are English); the
  student can still tag manually in any language.
