# Product Overview

A suite of web tools that support an **inductive Bible study methodology** — a structured, repeatable method for studying a book of the Bible through observation, interpretation, and application. The method proceeds through 17 numbered steps, and this product provides a focused tool for individual steps that benefit from software support. Each tool guides a student through one step with a worksheet, saves their work, and lets them build a library of studies over time.

The word-study tool (**Step 5 — Define Key Words**) is the first tool built. Additional step tools are added over time; not every step will become a tool, only those where guided, savable worksheets add value.

## Product intent

The product is a **digital companion to the inductive method**, not a replacement for it. The method is the fixed thing; the software exists to assist the steps where a computer genuinely helps — capturing the student's work, doing the mechanical lookups (dictionary, concordance, lexicon, cross-references), imposing structure (scroll, outline, element charts), and linking related material — so the student spends their effort on observation, interpretation, and application rather than on bookkeeping.

Three commitments follow from that intent and bound every tool:

- **Assist, never replace the student's own work.** The method's value is the student doing the observing and reasoning. Tools prompt, capture, and organize; they do not hand over conclusions. The AI summary in Step 5 synthesizes *the student's own notes* — it is the one assisted step, deliberately placed last, after the student has done the work.
- **Not every step is a tool.** Some steps are spiritual (1 Pray, 17 Obey) or interpersonal (15 Discuss) and software should stay out of their way. Others are good software candidates because they are concrete, data-backed, and worksheet-shaped — which is why Step 5 (key words) and Step 6 (antecedents/referents) were chosen first. See the software-fit tags on each step below.
- **One step, one focused tool.** Each tool supports a single step with a guided, savable worksheet, so the product grows as a suite of small focused tools rather than one monolith. A student builds a library of studies across tools over time.

## The inductive method

The 17 steps are grouped into three phases. The source material is the methodology reference the maintainer follows (step names below match it; see `docs/references/` for per-step reference material as it is added).

Each step carries a **software-fit tag** — how it stands with respect to becoming a tool:

- **shipped** — a tool for this step is live.
- **planned** — a tool is intended and has a spec or is next up.
- **candidate** — a good fit for a future tool; not yet specced.
- **manual** — stays pencil-and-paper by design: a spiritual, interpersonal, or free-reading step software should not try to replace. Do not draft a tool spec for a `manual` step.

### Observation
1. Pray — *manual* (spiritual)
2. Read the Book — *manual* (free reading; software adds little beyond pointing at a Bible)
3. Research the Background — *candidate* (structured background questions + saved answers)
4. Observe the Text as a Scroll — *candidate* (digital scroll: continuous text, annotation, theme markers)
5. Define Key Words — *shipped* (Word Study)
6. Identify Antecedents, Referents, Audience, and Speaker — *planned* (Pronoun Study)
7. Analyze the Structure of the Book — *candidate* (repeated-word search, element charts, tone/transition markers)
8. Make a Provisional Outline — *candidate* (paragraph list → title → bracket → group → outline form)
9. State a Provisional Theme and Purpose — *candidate* (derives from the outline in Step 8; likely folded into that tool)

### Interpretation
10. Identify Figures of Speech — *candidate* (tag figures/parallelism against a reference list)
11. Identify the Genre — *candidate* (genre picker backed by the characteristics table)
12. Interrogate the Text — *candidate* (question bank + saved Q&A per passage)
13. Check Cross-References — *candidate* (cross-reference capture; locations only, never verse text)
14. Write a Condensed Paraphrase — *candidate* (expand the outline into a paraphrase, preserving genre/tone/POV)
15. Discuss the Text — *manual* (interpersonal; a discussion-group step, not a solo tool)

### Application
16. Draw Applications — *candidate* (capture applications by form: command, warning, promise, example, implication)
17. Obey God's Word — *manual* (spiritual)

## Study tools

Each subsection is a tool for one step. "Shipped" tools are live; "planned" tools are intended but not yet built.

### Step 5 — Define Key Words (Word Study) — shipped

A student enters an English word and a Strong's concordance number, then works through a guided worksheet:

1. English definition (free dictionary API), with the student's notes.
2. Strong's concordance entry (original word, transliteration, definition), with notes.
3. Lexicon entry, with notes.
4. Cross-references: verse locations only (no copyrighted verse text); the student looks each one up in their own Bible and records observations.
5. AI summary (Amazon Bedrock, Claude Haiku) that synthesizes the study and the student's observations.

See `.kiro/specs/word-study-tool/requirements.md` for the full spec. Studies saved before 2026-04-27 store the English definition as a plain string; the app reads both shapes.

### Step 6 — Identify Antecedents, Referents, Audience, and Speaker (Pronoun Study) — planned

A tool to help a student resolve the references in a passage before interpreting it: identifying what each pronoun and possessive adjective points to (its **antecedent**), what a descriptive phrase stands for (its **referent**), the intended **audience** of the book, and the **speaker** whose voice is being expressed (which is not always the author). Reference material for this step is at `docs/references/inductive-study-step-6.md`.

This tool is being built across several specs under `.kiro/specs/`: `scroll-text-upload` and `parse-scroll-for-pronouns` (get the passage in and find its pronouns), `antecedent-analysis` and `antecedent-category-classifier` (resolve and classify antecedents), `referent-analysis` (resolve referents), and `organize-studies-by-book` (file studies under their book, following the method's book-by-book principle).

## Domain vocabulary

Use these terms with their study-specific meanings:

- **Antecedent** — the noun a pronoun or possessive adjective replaces (e.g. "Jesus" for "He").
- **Referent** — the person or thing a descriptive term stands for (e.g. "the ruler of this world" → Satan).
- **Audience** — the intended original readership of a book; interpretation depends on it.
- **Speaker vs. author** — the author writes the book; the speaker is the voice expressed, which can change within a passage and is not always truthful (e.g. Satan, Job's friends).
- **Strong's number** — an index number (e.g. `G25`, `H157`) keying a Hebrew or Greek word; `H` = Old Testament, `G` = New Testament.
- **Concordance / lexicon** — the Strong's concordance entry and the extended lexicon entry for a Strong's number.
- **Cross-reference** — another verse location where the same Strong's number appears; the app serves locations only, never copyrighted verse text.

## Guiding constraints

- **No copyrighted Bible text.** The app serves verse *locations* only; the student reads verses in their own Bible and records observations. AI prompts contain only Strong's data and the student's notes.
- **Student-driven observation.** Tools guide and capture the student's own work; they don't replace it.
- **One step, one focused tool.** Each tool supports a single step of the method with a guided, savable worksheet.

## Users

Individual Bible students. The sole maintainer is the only administrator.

## Stages and domains

| Stage | URL | Notes |
|---|---|---|
| prod | https://wordstudy.teksnextdoor.com | Self sign-up on. Planned move to `axiostools.teksnextdoor.com` (`docs/domain-cutover.md`). |
| dev | https://axiostools-dev.teksnextdoor.com | Self sign-up off (test users via CLI). Seeded with a 10-number Strong's subset. |
