# Requirements: Make a Provisional Outline (Step 8 — Outline Study)

## Context and assumptions

Issue #40 asks for the **Step 8 — Make a Provisional Outline** tool (an **Outline Study**), the
next unshipped Observation step after the shipped **Structure Study** (Step 7). Step 7 lets a
student name a book's genre and tone and divide it into ordered **sections** (each with a label,
start/stop passage reference, and notes). Step 8 is where the student turns that structure into a
working **outline** of the book's flow of thought.

The inductive method (`Steps to Bible Knowledge`, James G. McCarthy) breaks Step 8 into **six
sub-steps**, each a mechanical bookkeeping act over an ordered, nestable list of titled nodes:

1. **List the paragraphs** of the book.
2. **Title each paragraph** (3–6 words, drawn from its topic sentence).
3. **Bracket** similar sequential paragraphs together.
4. **Title the brackets.**
5. **Group** further (brackets into larger units).
6. Put it in **standard outline form** (I / A / 1 / a).

Software's role is to hold that nestable list and render it in standard form, never to decide the
outline. The student writes every title and makes every grouping call. This is the same
"software surfaces structure, the student makes every judgment" stance the shipped Step 4–7 tools
take, and the same copyright stance: the tool stores the student's own **titles and passage
locations only — never verse text**, and sends nothing to any AI prompt.

This feature mirrors the shipped **Structure Study** (`.kiro/specs/analyze-book-structure/`) and
**Antecedent Study** (`.kiro/specs/antecedent-analysis/`) precisely: one persisted record per
scroll per user, keyed by `scrollStudyId`, reached from the scroll, served by a new CRUD Lambda
behind the existing Cognito-authorized API Gateway, backed by a new additive, stateful-safe
DynamoDB table. It reuses the Angular 21 standalone + signals + Bulma patterns and the
scroll-nested routing used by `structure-view`, `antecedent-view`, and `pronoun-view`.

Assumptions (flagged for design review; each is the lowest-risk reading of the issue):

- **A1 — one Outline Study per scroll per user, keyed by `scrollStudyId`.** Exactly like
  `StructureStudy`/`AntecedentStudy`: fetched by exact key, upserted on save, no GSI, a two-method
  `GET`/`PUT` under the scroll (`/scroll-studies/{id}/outline`). An Outline Study is always reached
  from its one scroll, so no list/collection surface is added.
- **A2 — the outline is a flat, ordered list of nodes carrying an explicit `level`, not a nested
  tree.** Each node has an integer `level` (0 = top division "I", 1 = "A", 2 = "1", 3 = "a") plus a
  `title` and optional `startRef`/`endRef`/`notes`. Standard outline-form numbering (I / A / 1 / a)
  is **derived client-side** from the ordered list + levels — a pure function, nothing persisted.
  A flat ordered+level list (rather than a recursive children structure) is chosen because it is
  trivially reorderable (move up/down, indent/outdent) with the same signal-update pattern the
  Structure Study sections already use, and it serializes cleanly to one DynamoDB item.
- **A3 — seed from Step 7 without re-entry.** When the student has a saved `StructureStudy` for the
  same scroll and no Outline Study yet, the tool offers to **import the Step 7 `sections`** as the
  initial top-level nodes (level 0), carrying over each section's `label` → `title` and its
  `startRef`/`endRef`/`notes`. Importing is an explicit, student-triggered action (a button), never
  automatic, and it never overwrites an existing saved outline. This realizes the "sections list is
  shaped so Step 8 can consume it without re-entry" handoff the Step 7 design committed to.
- **A4 — standard outline numbering is I / A / 1 / a, cycling for deeper levels.** Level 0 →
  uppercase Roman (I, II, III), level 1 → uppercase letter (A, B, C), level 2 → arabic (1, 2, 3),
  level 3 → lowercase letter (a, b, c). Levels deeper than 3 reuse the arabic/lowercase cycle, which
  is sufficient for a book outline; this is a deliberately bounded, documented rule, not an open
  numbering engine.
- **A5 — no new Bible text and no server-side text processing.** Unlike Step 7, Step 8 derives
  nothing from the scroll text itself — it operates purely on the student's own titles and the Step 7
  sections. The scroll text is read only to show the student context (the same `ready`-scroll gate),
  not parsed. The backend is a single CRUD surface (no Bedrock, no text parsing).

## Requirements

### Requirement 1 — Open the Outline Study for a ready scroll

**User story:** As a student, I want to open an outline worksheet for a book whose scroll is ready,
so that I can build its provisional outline.

#### Acceptance criteria

1. WHEN the student navigates to `/scroll/:scrollStudyId/outline` AND the scroll study `status` is
   `ready` THEN the system SHALL show the Outline Study worksheet for that scroll.
2. WHEN the scroll study `status` is `uploading` or `extracting` THEN the system SHALL show a
   "scroll text still being prepared" message and a back link to `/scroll/:scrollStudyId`, and SHALL
   NOT show the worksheet (mirroring `structure-view`).
3. WHEN the scroll study `status` is `failed`, OR the scroll study is not found (404) THEN the
   system SHALL show an explanatory message and a back link to `/scrolls`.
4. WHEN the worksheet opens THEN the system SHALL fetch any saved Outline Study for the scroll; a
   404 (none saved yet) SHALL present an empty, editable worksheet without an error.

### Requirement 2 — List, title, and edit outline nodes

**User story:** As a student, I want to add nodes to the outline and title each one, so that I can
capture the book's divisions in my own words.

#### Acceptance criteria

1. WHEN the student adds a node THEN the system SHALL append a new node with an empty `title`,
   `level` equal to the previous node's level (or 0 when the list is empty), and empty
   `startRef`/`endRef`/`notes`.
2. WHEN the student edits a node's `title`, `startRef`, `endRef`, or `notes` THEN the system SHALL
   update only that node, preserving list order and all other fields.
3. The system SHALL enforce the field length limits used by the Structure Study: `title` ≤ 200
   (required, non-empty to persist), `startRef`/`endRef` ≤ 50, `notes` ≤ 1000.
4. WHEN the student removes a node THEN the system SHALL remove only that node and preserve the
   order and levels of the rest.

### Requirement 3 — Reorder and nest nodes (bracket and group)

**User story:** As a student, I want to move nodes up and down and change their indent level, so
that I can bracket similar paragraphs and group them into larger divisions (sub-steps 3–5).

#### Acceptance criteria

1. WHEN the student moves a node up or down THEN the system SHALL swap it with its neighbour,
   preserving each node's `level` (same reorder behaviour as Structure Study sections).
2. WHEN the student indents a node THEN the system SHALL increase its `level` by 1, up to a maximum
   of 3; WHEN the student outdents a node THEN the system SHALL decrease its `level` by 1, to a
   minimum of 0.
3. The system SHALL render each node at an indentation that reflects its `level`, so bracketing and
   grouping are visible.

### Requirement 4 — Render standard outline form

**User story:** As a student, I want to see my nodes numbered in standard outline form, so that I
have the finished Step 8 artifact.

#### Acceptance criteria

1. WHEN the worksheet renders the nodes THEN the system SHALL compute a standard outline label for
   each node from its `level` and its position among its same-level siblings under the same parent:
   level 0 → uppercase Roman (I, II, …), level 1 → uppercase letter (A, B, …), level 2 → arabic
   (1, 2, …), level 3 → lowercase letter (a, b, …).
2. The outline-label computation SHALL be a **pure, client-side function** of the ordered node list
   and levels, persisting nothing and introducing no Bible text.
3. The system SHALL restart sibling numbering under each new parent (e.g. the first level-1 node
   after a new level-0 node is "A", not a continuation).

### Requirement 5 — Seed from the Step 7 Structure Study

**User story:** As a student who finished Step 7, I want to import my sections as the starting
outline nodes, so that I don't re-type the structure I already drew.

#### Acceptance criteria

1. WHEN a saved `StructureStudy` exists for the scroll AND the Outline Study has no saved nodes THEN
   the system SHALL offer an explicit "Import sections from Step 7" action.
2. WHEN the student triggers the import THEN the system SHALL create one level-0 node per Step 7
   section, in order, copying each section's `label` → `title` and its `startRef`/`endRef`/`notes`.
3. The import SHALL be student-triggered only (never automatic) and SHALL NOT overwrite an outline
   that already has nodes; when nodes exist, the action is hidden or disabled with an explanation.
4. WHEN no `StructureStudy` exists for the scroll THEN the import action SHALL be absent, and the
   student SHALL still be able to build the outline from scratch.

### Requirement 6 — Persist and reload the outline

**User story:** As a student, I want to save my outline and reopen it later, so that it is a
re-openable worksheet.

#### Acceptance criteria

1. WHEN the student saves THEN the system SHALL `PUT` the full worksheet (ordered nodes with their
   titles, levels, refs, notes) to `/scroll-studies/{scrollStudyId}/outline` and show a save
   confirmation.
2. The system SHALL drop nodes left with an empty `title` before persisting (mirroring the Structure
   Study's empty-label drop), and SHALL reflect the server-normalised worksheet after save.
3. WHEN a save fails THEN the system SHALL keep the student's entered values and show an error
   without losing work.
4. The server SHALL set `userId` (from the Cognito authorizer) and `createdAt`/`updatedAt`; the
   client SHALL NOT send them.

### Requirement 7 — Backend CRUD, additive and stateful-safe

**User story:** As the system owner, I want the Outline Study stored like the other per-scroll
worksheets, so that it is consistent, isolated per user, and safe to deploy onto the live stack.

#### Acceptance criteria

1. The system SHALL add a new `OutlineStudies` DynamoDB table (PK/SK string keys, PAY_PER_REQUEST,
   AWS-managed encryption, `config.statefulRemovalPolicy`), mirroring `StructureStudies`; no GSI.
2. The system SHALL add a new `OutlineStudy` CRUD Lambda serving `GET`/`PUT`
   `/scroll-studies/{scrollStudyId}/outline` behind the existing Cognito authorizer, scoping every
   item to the caller's `userId`.
3. The Lambda SHALL validate every node field server-side (title required and ≤ 200, level an
   integer 0–3, refs ≤ 50, notes ≤ 1000, nodes an array) and reject malformed input with a 400,
   mirroring the structure-study Lambda's validation.
4. The change SHALL be purely additive: existing tables, functions, routes, and records SHALL be
   unchanged, so the deploy is stateful-safe (new table takes DynamoDB table count 6 → 7, new
   function takes Lambda count 8 → 9).

## Out of scope

- Generating outline titles or groupings automatically — the student authors every title and
  decides every grouping.
- Step 9 (State a Provisional Theme and Purpose) capture — a likely follow-on, not this feature.
- Any new source of Bible text, or any server-side parsing of the scroll text.
- A free-standing outline collection, list view, or cross-scroll outline — an Outline Study is
  always reached from its one scroll.
