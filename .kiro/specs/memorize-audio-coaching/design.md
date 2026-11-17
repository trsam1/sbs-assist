# Design: Memorize the Scroll — Audio coaching

## Overview

Frontend only. A pure **session planner** turns a verse (or a due-queue chunk) into an ordered list of
steps (`speak`, `wait`, `record`, `grade`, `announce`). A small **runner** executes one step at a time
against three injectable ports: `Speaker` (speechSynthesis), `Recorder` (MediaRecorder plus silence
detection), and `Keepalive` (Wake Lock plus Media Session). The existing `RecitationGradeService` and
`applyGrade` are reused unchanged.

Files (all under `src/app/memorize-view/`):

- `coach-plan.ts` — pure: phrase splitting, pause lengths, Learn and Test step plans.
- `coach-runner.ts` — runs a plan against the ports; owns pause/resume/skip/repeat/stop.
- `coach-ports.ts` — browser implementations of `Speaker`, `Recorder`, `Keepalive`, plus feature checks.
- `memorize-view.component.ts` — coaching bar, start controls, wiring to the existing Learn and Test state.

## Phrase splitting (`coach-plan.ts`)

`splitPhrases(verseText, maxWords = 8): string[]`

- Strip leading verse numerals. Split after `, ; : . ? !`.
- A piece longer than `maxWords` is split at the nearest word boundary to its midpoint, recursively.
- A piece shorter than 3 words merges into its neighbor, so the student is never asked to repeat "and he".
- Pure, deterministic, unit-tested on real verses: short, long, no punctuation, quoted speech, verse
  numbers in the middle of the text, empty input.

`pauseMs(phrase, perWordMs, floorMs = 2500)`: `max(floorMs, wordCount × perWordMs)`. Default
`perWordMs` is 700.

## Step model

```ts
type CoachStep =
  | { kind: 'speak'; text: string; label: string }
  | { kind: 'wait'; ms: number; label: string }
  | { kind: 'record'; label: string }
  | { kind: 'grade'; chunkId: string }
  | { kind: 'announce'; resultOf: 'grade' };
```

`label` is the on-screen text for the coaching bar (R3.7).

### Learn plan: `planLearnVerse(verseText, priorVersesText | null, opts)`

1. `speak` the whole verse (label "Listen").
2. For each phrase `k` (1-based): `speak` phrase k ("Repeat after me"), `wait` pauseMs(k), then when
   `k > 1`: `speak` "Together", `speak` phrases 1..k joined, `wait` pauseMs(1..k).
3. `speak` "Now the whole verse", `wait` pauseMs(whole), `speak` the verse ("Check yourself").
4. If `priorVersesText`: `speak` "Verses 1 through N", `wait` pauseMs(all), `speak` the joined text.

### Test plan: `planTestChunk(chunk)`

`speak` reference and "Your turn", `record`, `grade`, `announce`, then a `wait` of the configured
continue pause. "Hear it" is a student tap (a button, and a Media Session "next" action) that inserts a
`speak` of the chunk text before the wait ends.

## Runner (`coach-runner.ts`)

```ts
class CoachRunner {
  constructor(plan: CoachStep[], ports: CoachPorts, hooks: CoachHooks)
  start(): Promise<void>   // runs steps in order
  pause(); resume(); skip(); repeat(); stop();
}
```

- One step runs at a time. `pause` cancels the current speech or wait and remembers the step index;
  `resume` restarts that step. `repeat` re-runs the previous `speak`. `skip` jumps to the next step. `stop`
  cancels everything and calls `Keepalive.release()` and `Recorder.release()`.
- `hooks.onStep(step)` updates the coaching bar. `hooks.onGradeResult(result)` hands the async grade back
  to the component, which calls the existing Test-mode grade path so scheduling stays in one place.
- A `generation` counter makes stale timers and callbacks from a previous run inert.

## Ports (`coach-ports.ts`)

- **Speaker.** Wraps `speechSynthesis`. `speak(text, {voice, rate})` resolves on `end`, rejects on
  `error`. Long text is spoken in sentences, because Chrome silently stops utterances over about 15 s. A
  watchdog resolves a speak that never fires `end` (a known iOS and Chrome issue) after an estimated
  duration plus margin. Voices load asynchronously (`voiceschanged`), so the picker waits for them.
- **Recorder.** Wraps the existing `startRecording` flow. Adds silence detection: an `AudioContext` and
  `AnalyserNode` sample RMS every 100 ms; recording stops after `silenceMs` (default 2500) of RMS below a
  threshold once speech has started, or at the maximum clip length. If speech never starts within 12 s,
  it stops and the grade step is skipped with "I didn't hear anything". Echo from the speaker during
  recording is avoided because recording starts only after speech ends and the tone finishes.
- **Keepalive.** `navigator.wakeLock.request('screen')` when available, re-requested on
  `visibilitychange`. Media Session metadata and `play`, `pause`, `nexttrack` handlers map to the runner.
  Playing a silent looping `<audio>` element is deliberately not used; it is a hack that behaves
  differently across browsers.

All three have feature checks (`speechSupported()`, `recordingSupported()` already exists,
`wakeLockSupported()`), which the component uses to hide or degrade controls (R2.8, R3.4).

## Component wiring

- State signals: `coachMode: 'off' | 'learn' | 'test'`, `coachStep`, `coachPaused`, `coachPrefs`
  (voice name, rate, perWordMs, silenceMs, continuePauseMs, tones on/off), persisted to `localStorage`
  under a single versioned key. Invalid stored values fall back to defaults.
- Learn: a "Coach me" button on the active verse card (visible when `speechSupported()`). It builds
  `planLearnVerse` from the same `splitVerses` data Learn already uses and starts the runner.
- Test: a "Coach test" button in Test mode. It builds one plan per due chunk. A `grade` step runs the
  existing grading flow with Drive-mode semantics: `commitTestGrade` applies the result, including the
  existing "Again" handling. Test coach implies Drive mode for its session.
- A fixed bottom coaching bar shows step label, a progress hint ("phrase 3 of 6"), and the four large
  buttons. Starting a session is the user gesture (A2).
- Leaving Learn or Test, or navigating away, calls `runner.stop()` in `ngOnDestroy` and on mode change.

## Edge cases

- Verse with no punctuation: split purely by word count.
- A one-verse chunk in Learn: skip the cumulative prior-verses pass.
- Empty or whitespace verse text: the session ends immediately with "Nothing to coach".
- Microphone denied: Test coach announces it once, then runs in self-check mode (R2.8).
- Grade is `degraded` or the transcript is empty: announce "scored by word match" and commit the computed
  grade, which is what Drive mode does today. (Changing that is a separate decision.)
- Phone call or other app takes audio focus: speech `error` pauses the session and shows Resume.
- Duplicate taps on Start: ignored while `coachMode !== 'off'`.

## Testing

- `coach-plan.spec.ts`: phrase splitting cases above, pause lengths, Learn plan order and chaining, Test
  plan order, single-verse chunk.
- `coach-runner.spec.ts`: with fake ports and fake timers: runs in order, pause/resume resumes the same
  step, skip, repeat, stop releases all ports, stale callbacks after stop do nothing.
- Component specs: buttons hidden when `speechSupported()` is false; Learn session never changes Learn
  progress or the schedule; Test session applies a grade through the existing path; prefs persist and
  reject bad stored values. Port wrappers are stubbed, per the standing rule that new injected services
  get a stub in each affected spec.
- No test touches real speech, microphone, or AWS.

## Rollout and risk

- No backend or infra change. CDK diff: SPA asset-hash rotation only; the stateful guard is expected to be
  clean.
- Real-world risk is browser behavior, not logic: iOS speech and recording when the screen locks, voice
  quality, silence thresholds in a noisy car. The plan is to ship, drive with it once, and tune the defaults
  (`perWordMs`, `silenceMs`, threshold). All are student-adjustable settings for that reason.
- Fallback if the browser voices are poor: a follow-up spec for Amazon Polly (cost and privacy trade-off,
  see Out of scope).

## Build order (for the implementing PR)

1. `coach-plan.ts` with tests.
2. `coach-runner.ts` with tests.
3. `coach-ports.ts` wrappers and feature checks.
4. Component wiring, coaching bar, preferences.
5. Learn coach, then Test coach, then manual verification checklist in the PR.
