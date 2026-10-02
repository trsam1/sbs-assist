# Product Overview

A Bible word-study tool (see `.kiro/specs/word-study-tool/requirements.md`). A student enters an English word and a Strong's number, then works through a guided worksheet:

1. English definition (free dictionary API), with the student's notes.
2. Strong's concordance entry (original word, transliteration, definition), with notes.
3. Lexicon entry, with notes.
4. Cross-references: verse locations only (no copyrighted verse text); the student looks each one up in their own Bible and records observations.
5. AI summary (Amazon Bedrock, Claude Haiku) that synthesizes the study and the student's observations.

Users sign in with Cognito (email + password) and can save, list, reopen, and delete studies. Studies saved before 2026-04-27 store the English definition as a plain string; the app reads both shapes.

## Users

Individual Bible students. The sole maintainer is the only administrator.

## Stages and domains

| Stage | URL | Notes |
|---|---|---|
| prod | https://wordstudy.teksnextdoor.com | Self sign-up on. Planned move to `axiostools.teksnextdoor.com` (`docs/domain-cutover.md`). |
| dev | https://axiostools-dev.teksnextdoor.com | Self sign-up off (test users via CLI). Seeded with a 10-number Strong's subset. |
