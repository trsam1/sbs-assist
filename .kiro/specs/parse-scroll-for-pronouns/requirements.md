# Requirements: Parse Scroll for Pronouns (Step 6 — Identify Antecedents, Referents, Audience, and Speaker)

## Context and assumptions

The issue asks for a "list of all pronouns found within a given scroll," with an optional
highlight of pronouns in a scroll view. This is the first slice of the planned **Step 6 —
Pronoun Study** tool (`docs/references/inductive-study-step-6.md`). Step 6 asks a student to
pause at each pronoun and possessive adjective and identify its antecedent; the reference also
covers referents, audience, speaker, and point of view. This increment delivers only the
mechanical first move of that step — **finding the pronouns in the book's text so the student
has a worklist** — and defers the interpretive work (recording antecedents, referents, audience,
speaker) to a later increment (Out of Scope).

The only running text of a book the app holds is the **extracted scroll text** produced by the
shipped **Scroll Study** tool (Step 4 — Observe the Text as a Scroll; see
`.kiro/specs/scroll-text-upload/`). A Scroll Study stores the student's own extracted `scrollText`
once its status is `ready`. This feature therefore takes a `ready` Scroll Study as its input and
parses pronouns out of its already-persisted text; it introduces no new source of Bible text and
stores no copyrighted text (the scroll text is the student's own uploaded document, already
persisted and scoped to them).

This is a **frontend-only** feature (issue Area: frontend). Pronoun detection is a pure,
deterministic match against a fixed, client-owned dictionary of English pronouns and possessive
adjectives drawn from the Step 6 reference. No new API route, Lambda, DynamoDB table, or other
AWS resource is introduced; the scroll text is already available from `ScrollStudyService`.

Assumptions (flagged for the design review; each is the lowest-risk reading of the issue):

- **A1 — "a given scroll" = a `ready` Scroll Study.** The scroll is identified by its existing
  `scrollStudyId`; the feature reads `scrollText` from that record. A scroll that is not `ready`
  (uploading/extracting/failed) has no text to parse and is handled explicitly (Requirement 1).
- **A2 — "pronoun" = the closed set in the Step 6 reference.** Personal, possessive (nominative/
  objective/possessive case), possessive adjectives, demonstrative, indefinite, intensive,
  reflexive, interrogative, relative, reciprocal, and quantifier pronouns, including the archaic
  KJV forms the reference lists (thou, thee, thine, thy, ye). This is a fixed dictionary, not a
  grammatical parser; a word is a pronoun iff its lower-cased form is in the dictionary.
- **A3 — matching is whole-word and case-insensitive.** "He" and "he" are the same pronoun;
  "the" is never matched inside "there". Punctuation adjacent to a word does not block a match.
- **A4 — this increment lists and (optionally) highlights only.** It does not let the student
  record an antecedent/referent/audience/speaker per occurrence, and it does not persist any new
  record. The parse runs on demand from the already-persisted scroll text.

---

## Requirement 1: Parse a ready scroll for its pronouns

### User Story
As a Bible student, I want the app to find every pronoun in the scroll text of a book I have
uploaded, so that I have a complete worklist of pronouns to identify antecedents for in Step 6.

### Acceptance Criteria
1. WHEN the student opens the pronoun view for a Scroll Study whose status is `ready` THEN the
   system SHALL parse that study's `scrollText` and produce the set of distinct pronouns it
   contains, together with an occurrence count for each.
2. The system SHALL treat a word as a pronoun IF AND ONLY IF its lower-cased, punctuation-stripped
   form is a member of the fixed pronoun dictionary (the Step 6 set in assumption A2).
3. Matching SHALL be case-insensitive and whole-word: a dictionary pronoun SHALL match only a
   full token, never a substring of a longer word (e.g. "it" SHALL NOT match inside "with").
4. WHEN the scroll text contains no pronoun-dictionary words THEN the system SHALL display an
   empty-state message ("No pronouns found in this scroll.") rather than an error.
5. WHEN the referenced Scroll Study status is `uploading` or `extracting` THEN the system SHALL
   show a non-blocking "the scroll text is still being prepared" message and SHALL NOT attempt to
   parse.
6. WHEN the referenced Scroll Study status is `failed`, or the study does not exist or does not
   belong to the user (API returns 404) THEN the system SHALL show an explanatory message and a
   link back, and SHALL NOT attempt to parse.

### Correctness Properties
- Property: `isPronoun(token)` is pure and returns `true` for every member of the dictionary in
  any letter case and surrounded by punctuation, and `false` for any token whose stripped,
  lower-cased form is not in the dictionary.
- Property: For any input text, `parsePronouns(text)` returns one entry per distinct dictionary
  pronoun present, each with `count >= 1`, and `sum(counts)` equals the number of whole-word
  pronoun tokens in the text (so no occurrence is double-counted or dropped).
- Property: `parsePronouns('')` returns an empty list and never throws.

---

## Requirement 2: Display the pronoun list

### User Story
As a Bible student, I want to see the pronouns found in my scroll listed clearly, so that I can
see which pronouns appear and how often.

### Acceptance Criteria
1. WHEN a parse produces results THEN the system SHALL display each distinct pronoun with its
   occurrence count.
2. The list SHALL be ordered deterministically: by occurrence count descending, then
   alphabetically ascending for ties, so the same scroll always renders the same order.
3. The system SHALL display the total number of distinct pronouns and the total number of pronoun
   occurrences found.
4. The pronoun list SHALL be keyboard reachable and screen-reader labeled, matching the ARIA
   patterns already used in the app (`aria-label`, `aria-live`, Bulma components).

---

## Requirement 3: Optional highlight of pronouns in the scroll view

### User Story
As a Bible student, I want to optionally see the pronouns highlighted within the scroll text, so
that I can see each pronoun in its context while I work through the book.

### Acceptance Criteria
1. The system SHALL provide a toggle (default off) that, when on, renders the scroll text with
   every pronoun occurrence visually highlighted in place.
2. WHEN highlighting is on THEN every token that is a dictionary pronoun (Requirement 1 criteria
   2–3) SHALL be wrapped in a highlight marker, and non-pronoun text SHALL be rendered unchanged,
   preserving the scroll text's original whitespace and line breaks (the same `pre-wrap`
   treatment the scroll view already uses).
3. WHEN highlighting is off THEN the scroll text SHALL render exactly as the plain scroll view
   renders it today (no markup differences).
4. Highlight rendering SHALL escape the scroll text so that document content containing
   HTML-significant characters (`<`, `>`, `&`) is displayed literally and never interpreted as
   markup.
5. The highlight toggle SHALL be keyboard operable and its state SHALL be announced to assistive
   technology (e.g. `aria-pressed`).

### Correctness Properties
- Property: With highlighting on, concatenating the text content of all rendered segments (markup
  stripped) equals the original `scrollText` exactly — highlighting changes presentation only, not
  the characters shown.

---

## Non-Functional Requirements

1. **Frontend-only / no new AWS resources.** Pronoun parsing runs in the browser against the
   scroll text already returned by `ScrollStudyService`; no new API route, Lambda, DynamoDB table,
   S3 object, or other AWS resource is introduced, and `infra/lib/stage-config.ts` is unchanged.
2. **Serverless-first / cost.** Because the parse is client-side over already-fetched data, this
   feature adds no per-request compute or storage cost beyond the existing scroll `GET`.
3. **No copyrighted-text policy unchanged.** The parsed text is the student's own uploaded scroll,
   already persisted and user-scoped; this feature neither serves app-provided Bible text nor
   places the scroll text into any AI prompt.
4. **Auth and scoping.** The scroll text is fetched through the existing authenticated
   `ScrollStudyService` path; a student can only parse their own scroll (the API returns 404 for a
   scroll they do not own, handled by Requirement 1 criterion 6).
5. **Accessibility.** New UI SHALL be keyboard operable and screen-reader labeled, matching the
   ARIA patterns already used (`aria-label`, `aria-live`, `aria-pressed`, `is-sr-only`).
6. **Determinism / performance.** Parsing a typical single Bible book (the scroll-text spec caps
   stored text at ~350 KB) SHALL complete within a single synchronous pass without blocking the UI
   perceptibly; the parse is O(n) over the characters of the text.

---

## Out of Scope

- Recording or storing a per-occurrence antecedent, referent, audience, speaker, or point-of-view
  classification (the interpretive heart of Step 6) — this increment only locates pronouns.
- Classifying pronouns by type (personal vs. demonstrative vs. relative, etc.), person
  (first/second/third), gender, number, or case; the list is a flat set of matched word forms.
- Persisting a new "Pronoun Study" record or any new DynamoDB/API entity; the parse is derived
  on demand from the existing Scroll Study.
- Grammatical/NLP parsing, lemmatization, or disambiguation (e.g. distinguishing demonstrative
  "that" from relative "that"); matching is dictionary-based only.
- Non-English scroll text (the dictionary is English, including archaic KJV forms only).
- Jumping/scrolling from a list entry to each in-text occurrence, or per-occurrence navigation
  (the highlight shows occurrences in place; cross-navigation is a later increment).
- Any change to the Scroll Study upload/extraction flow, the Word Study tool, or the Book Study
  tool.
