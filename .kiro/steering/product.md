# Product Overview

A suite of web tools that support an **inductive Bible study methodology** — a structured, repeatable method for studying a book of the Bible through observation, interpretation, and application. The method proceeds through 17 numbered steps, and this product provides a focused tool for individual steps that benefit from software support. Each tool guides a student through one step with a worksheet, saves their work, and lets them build a library of studies over time.

The word-study tool (**Step 5 — Define Key Words**) is the first tool built. Additional step tools are added over time; not every step will become a tool, only those where guided, savable worksheets add value.

## The inductive method

The 17 steps are grouped into three phases. The source material is the methodology reference the maintainer follows (step names below match it; see `docs/references/` for per-step reference material as it is added).

### Observation
1. Pray
2. Read the Book
3. Research the Background
4. Observe the Text as a Scroll
5. Define Key Words
6. Identify Antecedents, Referents, Audience, and Speaker
7. Analyze the Structure of the Book
8. Make a Provisional Outline
9. State a Provisional Theme and Purpose

### Interpretation
10. Identify Figures of Speech
11. Identify the Genre
12. Interrogate the Text
13. Check Cross-References
14. Write a Condensed Paraphrase
15. Discuss the Text

### Application
16. Draw Applications
17. Obey God's Word

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
