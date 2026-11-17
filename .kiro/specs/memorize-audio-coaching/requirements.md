# Requirements: Memorize the Scroll — Audio coaching (hands-free Learn and Test)

## Context and assumptions

The student memorizes in the car and on walks, where touching the screen is unsafe or impractical.
Learn mode (spec `memorize-learn-mode`) and Test mode (spec `memorize-recitation-grade`) both work, but
every step needs a tap. This feature adds **audio coaching**: the app speaks, pauses for the student, and
listens, so a session can run with at most a tap to start.

Two coaching styles, modeled on a human partner:

- **Learn coach (the teacher, "repeat after me").** Ungraded. The app reads a phrase, pauses while the
  student repeats it aloud, then chains phrases together cumulatively until the whole verse, then the
  whole chunk so far, is said from memory.
- **Test coach (the friend, "your turn").** The app says the reference and prompts the student, records
  the recitation, grades it with the existing async pipeline, and speaks a short result.

Verse text is already on the student's device (it comes from their own scroll). Speech uses the browser's
built-in `speechSynthesis`, so no verse text is sent to a new service and there is no new AWS cost.

### Confirmed decisions (from the user's earlier direction)

- **D1 — Two modes, not one "read aloud" button.** Learn coach and Test coach behave differently, as above.
- **D2 — Primary use is hands-free in a car.** Large controls, audio-first, no required taps after start.
- **D3 — Test coach uses the real grading pipeline** (record, Transcribe, Bedrock), not browser speech
  recognition.
- **D4 — Learn coach is ungraded** and never changes the review schedule.

### Assumptions (flagged for review)

- **A1 — Frontend only.** No Lambda, infra, or data-model change. Coaching preferences (speech rate,
  pause length, phrase size) live in `localStorage`, like the existing per-study settings.
- **A2 — A tap is required to start a session.** Browsers block speech and microphone access until a user
  gesture. After that tap the session runs on its own.
- **A3 — Phrase boundaries** come from punctuation (`, ; : . ? !`), with a word cap so long clauses are
  split. Verse numbers are never spoken.
- **A4 — Screen lock.** On iOS, speech and recording can stop when the screen locks. The feature keeps the
  screen awake with the Screen Wake Lock API where available, and tells the student plainly when it
  cannot. A phone mounted in a car with the screen on is the supported setup.
- **A5 — The student's own voice is never stored beyond the existing 1-day clip lifecycle**, same as Test.

## Requirement 1: Learn coach session

**User story:** As a student learning a verse hands-free, I want the app to teach it to me phrase by phrase,
so that I can memorize without looking at or touching the phone.

1. **R1.1** A "Coach me" control starts a Learn coach session for the verse the student is on in Learn mode.
2. **R1.2** The coach speaks the whole verse once, then works through its phrases. For each phrase it speaks
   the phrase, then waits silently for the student to repeat it. The wait scales with the phrase length
   (words × a per-word allowance, with a floor), and the student can change the allowance.
3. **R1.3** After each new phrase the coach chains: it speaks phrases 1..k together, then waits, so the
   student says the growing passage from the start.
4. **R1.4** After the last phrase the coach prompts "now the whole verse", waits, then speaks the verse so
   the student can check themselves.
5. **R1.5** When the verse is not the first in the chunk, the coach finishes with a cumulative pass: it
   prompts for verses 1..N together, waits, then speaks them.
6. **R1.6** The student can say nothing and the session still advances. Silence is never an error.
7. **R1.7** The session never marks a verse learned, unlocks a verse, or grades anything. Those stay manual
   taps in Learn mode (D4, and Learn requirement D2).

## Requirement 2: Test coach session

**User story:** As a student testing myself hands-free, I want the app to prompt me, listen, and tell me how
I did, so that I can run through a deck while driving.

1. **R2.1** A "Coach test" control starts a Test coach session over the current due queue (the same chunks
   Test mode would show, in the same order).
2. **R2.2** For each chunk the coach speaks the reference and a cue ("your turn"), then starts recording
   with no tap. A short tone marks when recording begins.
3. **R2.3** Recording stops when the student goes quiet (silence detection), or at the existing maximum
   clip length. A manual stop control is always available.
4. **R2.4** The clip goes through the existing presign, upload, `grade-start`, `grade-status` pipeline.
   The coach says "checking" while it waits.
5. **R2.5** The coach speaks a short result: the grade word, the accuracy percentage, and up to three
   missed words ("you missed: righteous, forgive"). When the grade is degraded (no transcript), it says
   the answer was scored by word match, as the screen does today.
6. **R2.6** The grade is applied exactly as Test mode's existing Drive mode applies it (auto-commit, no touch), including the
   student's choice of "Again" handling (redo now or later this session).
7. **R2.7** After the result the coach offers to hear the verse ("say 'hear it' or wait to continue").
   Without voice commands, this is a configurable pause: the verse is read only when the student taps
   "Hear it", otherwise the coach continues to the next chunk after the pause.
8. **R2.8** When the microphone is unavailable or denied, the coach says so once and falls back to reading
   the reference and verse for self-check, with manual grade buttons.

## Requirement 3: Controls and safety

1. **R3.1** A coaching bar shows the current step in large text, with large Pause/Resume, Skip, Repeat, and
   Stop buttons (minimum 56 px tap targets).
2. **R3.2** Media Session API actions (play, pause, next) are wired where supported, so headset or steering
   wheel buttons control the session.
3. **R3.3** Stopping, leaving the page, or switching mode cancels speech and recording immediately and
   releases the microphone and the wake lock.
4. **R3.4** If `speechSynthesis` is missing, the coach controls are hidden and an explanation is shown. The
   rest of the app is unaffected.
5. **R3.5** The student can pick the voice from the browser's installed voices, the speech rate (0.7× to
   1.3×), and the pause allowance. Choices persist per device.
6. **R3.6** The coach never speaks or records without a prior tap in the current page load (A2).
7. **R3.7** Accessibility: every spoken step is also shown as text; controls have labels; motion and tones
   respect reduced-motion and a mute-tones option.

## Requirement 4: Non-functional

1. **R4.1** No new backend, IAM, or infra. The CDK diff for the implementing PR shows only SPA asset-hash
   rotation.
2. **R4.2** The scheduling logic (phrase splitting, pause lengths, session step machine) is pure TypeScript
   with unit tests. Speech, recording, and wake lock sit behind thin wrappers that tests replace.
3. **R4.3** No test calls real speech, microphone, Transcribe, or Bedrock.
4. **R4.4** Cost is unchanged: only the existing Test-mode Transcribe cost applies, and only in Test coach.

## Out of scope

- Voice commands ("next", "repeat", "hear it"). Browser speech recognition is unreliable in a noisy car,
  and D3 rules it out as the grader. Revisit after the first real drive.
- Server-side text-to-speech (Amazon Polly). It would add cost and send verse text off-device; the browser
  voices are the first try. Revisit if voice quality is a problem on the student's phone.
- Changing SM-2, Learn progress, or the data model.
