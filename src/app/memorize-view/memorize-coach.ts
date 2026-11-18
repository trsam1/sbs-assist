import {
  Injectable,
  InjectionToken,
  OnDestroy,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  CoachPrefs,
  CoachStep,
  DEFAULT_COACH_PREFS,
  RecordOutcome,
  normalizePrefs,
  planLearnVerse,
  planTestPrompt,
  resultSpeech,
} from './coach-plan';
import {
  createKeepalive,
  SpeakerOptions,
  createSpeaker,
  loadVoices,
  playTone,
  speechSupported,
} from './coach-ports';
import { CoachPorts, CoachRunner } from './coach-runner';
import { rangeText } from './learn';
import { MemorizeStore } from './memorize-store';
import { MemorizeTest } from './memorize-test.service';

/** The browser pieces a coaching session uses, behind one seam so tests can replace all of them. */
export interface CoachPlatform {
  supported: boolean;
  speaker: { speak(text: string): Promise<void>; cancel(): void };
  tone(): Promise<void>;
  keepalive: ReturnType<typeof createKeepalive>;
  loadVoices(): Promise<SpeechSynthesisVoice[]>;
}

export const COACH_PLATFORM = new InjectionToken<(opts: SpeakerOptions) => CoachPlatform>(
  'COACH_PLATFORM',
  {
    providedIn: 'root',
    factory: () => (opts) => ({
      supported: speechSupported(),
      speaker: createSpeaker(opts),
      tone: playTone,
      keepalive: createKeepalive(),
      loadVoices,
    }),
  },
);

export type CoachMode = 'off' | 'learn' | 'test';

export const COACH_PREFS_KEY = 'memorize-coach-prefs-v1';

/** After this many tries at one card (Test coach, "Again" with redo-now), move on instead of looping. */
export const MAX_ATTEMPTS_PER_CARD = 3;
/** How long Test coach listens for a first word before it gives up on a recitation. */
const NO_SPEECH_MS = 12_000;

/**
 * Audio coaching for the Memorize page: a hands-free Learn coach ("repeat after me", ungraded) and Test
 * coach ("your turn", recorded and graded through the existing pipeline in Drive mode). Provided by the page
 * component next to `MemorizeStore`. All timing and speech goes through `CoachRunner` and its ports.
 */
@Injectable()
export class MemorizeCoach implements OnDestroy {
  private readonly store = inject(MemorizeStore);
  private readonly test = inject(MemorizeTest);

  private readonly platform = inject(COACH_PLATFORM)({
    rate: () => this.prefs().rate,
    voiceName: () => this.prefs().voiceName,
  });

  readonly supported = this.platform.supported;
  readonly mode = signal<CoachMode>('off');
  /** What the coach is doing right now, in words, for the screen. */
  readonly label = signal('');
  /** "Step 3 of 12" style progress within the current verse, or ''. */
  readonly progress = signal('');
  readonly paused = signal(false);
  /** A short notice the student should see: an error, or how the session ended. */
  readonly notice = signal('');
  readonly prefs = signal<CoachPrefs>(this.loadPrefs());
  readonly voices = signal<SpeechSynthesisVoice[]>([]);
  /** In Test coach: the verse just tested, so "Hear it" can read it back after the card moves on. */
  readonly lastVerse = signal('');

  private runner: CoachRunner | null = null;
  private hearItRequested = false;
  private priorDriveMode: 'desk' | 'drive' | null = null;
  /** The page mode the session started in. */
  private sessionViewMode: string | null = null;

  constructor() {
    // Leaving Learn or Test (or changing mode in any way) ends the session.
    effect(() => {
      const current = this.store.viewMode();
      untracked(() => {
        // Only a real change of mode ends a session; reading the mode as it starts must not.
        if (this.mode() !== 'off' && current !== this.sessionViewMode) this.stop();
      });
    });
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /** Fill the voice picker. Called when the preferences panel opens. */
  async ensureVoices(): Promise<void> {
    if (this.voices().length === 0) this.voices.set(await this.platform.loadVoices());
  }

  // --- preferences --------------------------------------------------------------------------------

  setPrefs(change: Partial<CoachPrefs>): void {
    const next = normalizePrefs({ ...this.prefs(), ...change });
    this.prefs.set(next);
    try {
      localStorage.setItem(COACH_PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable (private mode): the choice lasts for this visit */
    }
  }

  private loadPrefs(): CoachPrefs {
    try {
      const raw = localStorage.getItem(COACH_PREFS_KEY);
      return raw ? normalizePrefs(JSON.parse(raw)) : { ...DEFAULT_COACH_PREFS };
    } catch {
      return { ...DEFAULT_COACH_PREFS };
    }
  }

  // --- controls -----------------------------------------------------------------------------------

  pause(): void {
    this.runner?.pause();
  }

  resume(): void {
    this.runner?.resume();
  }

  skip(): void {
    this.runner?.skip();
  }

  repeat(): void {
    this.runner?.repeat();
  }

  /** Test coach: read the verse just tested, then carry on. */
  hearIt(): void {
    if (this.mode() !== 'test') return;
    this.hearItRequested = true;
    this.runner?.skip();
  }

  /** End the session and release everything it held. Safe to call at any time. */
  stop(): void {
    const runner = this.runner;
    this.runner = null;
    runner?.stop();
    this.platform.keepalive.release();
    if (this.priorDriveMode) {
      this.store.setTestDriveMode(this.priorDriveMode);
      this.priorDriveMode = null;
    }
    this.mode.set('off');
    this.paused.set(false);
    this.label.set('');
    this.progress.set('');
  }

  // --- sessions -----------------------------------------------------------------------------------

  /** Learn coach for the verse the student is on. Never grades or unlocks anything. */
  async startLearn(): Promise<void> {
    if (!this.canStart() || this.store.viewMode() !== 'learn') return;
    const verses = this.store.learnVerses();
    const unlocked = this.store.learnProgress().unlocked;
    const verse = verses[unlocked - 1];
    if (!verse || !verse.text.trim()) {
      this.notice.set('Nothing to coach here yet.');
      return;
    }
    const prior = unlocked > 1 ? rangeText(verses, unlocked - 1) : null;
    const steps = planLearnVerse(verse.text, prior, this.prefs(), unlocked);

    const runner = await this.begin('learn', 'Learn coach');
    const result = await runner.run(steps);
    if (result === 'done') {
      this.finish('Finished. Tap "Got it" when you have this verse.');
    }
  }

  /** Test coach over the current deck, hands-free, in Drive mode. */
  async startTest(): Promise<void> {
    if (!this.canStart() || this.store.viewMode() !== 'test') return;
    if (this.store.deckComplete() || this.store.deck().length === 0) {
      this.notice.set('There is nothing to test right now.');
      return;
    }
    if (!this.test.recordingSupported()) {
      this.notice.set('This browser cannot record, so Test coach is not available.');
      return;
    }
    this.priorDriveMode = this.store.testDriveMode();
    this.store.setTestDriveMode('drive');

    const runner = await this.begin('test', 'Test coach');
    const ended = await this.testLoop(runner);
    if (ended === 'deck-done') {
      await runner.run([
        { kind: 'speak', text: "That's the deck. Well done.", label: 'Deck complete' },
      ]);
      this.finish('Deck complete.');
    }
  }

  private canStart(): boolean {
    if (!this.supported) {
      this.notice.set('Speech is not available in this browser.');
      return false;
    }
    return this.mode() === 'off';
  }

  /** Create the runner, take the screen wake lock and media keys, and mark the session as running. */
  private async begin(mode: Exclude<CoachMode, 'off'>, title: string): Promise<CoachRunner> {
    this.notice.set('');
    this.hearItRequested = false;
    const runner = new CoachRunner(this.ports(), {
      onStep: (step: CoachStep, i, n) => {
        this.label.set(step.label);
        this.progress.set(n > 1 ? `Step ${i + 1} of ${n}` : '');
      },
      onSpeechError: (e) => this.notice.set(`${e.message} Tap Resume to try again.`),
      onPausedChange: (p) => this.paused.set(p),
    });
    this.runner = runner;
    this.sessionViewMode = this.store.viewMode();
    this.mode.set(mode);
    await this.platform.keepalive.acquire(title, {
      onPlay: () => this.resume(),
      onPause: () => this.pause(),
      onNext: () => (mode === 'test' ? this.hearIt() : this.skip()),
    });
    return runner;
  }

  /** Ends a finished session with a closing notice. */
  private finish(notice: string): void {
    this.stop();
    this.notice.set(notice);
  }

  private ports(): CoachPorts {
    return {
      speak: (text) => this.platform.speaker.speak(text),
      cancelSpeech: () => this.platform.speaker.cancel(),
      tone: () => this.platform.tone(),
      record: () =>
        this.test.recordAndGrade({ silenceMs: this.prefs().silenceMs, noSpeechMs: NO_SPEECH_MS }),
      cancelRecord: () => this.test.cancelCoachedRecording(),
    };
  }

  // --- the Test coach loop ------------------------------------------------------------------------

  private async testLoop(runner: CoachRunner): Promise<'deck-done' | 'stopped' | 'no-mic'> {
    let attempts = 0;
    let lastCard = -2;

    while (!runner.isStopped && !this.store.deckComplete()) {
      const card = this.store.currentCardIndex();
      if (card !== lastCard) {
        attempts = 0;
        lastCard = card;
      }
      attempts += 1;

      this.lastVerse.set(this.store.gradeReferenceText());
      const reference = this.store.cardRef();

      if ((await runner.run(planTestPrompt(reference, this.prefs()))) === 'stopped')
        return 'stopped';
      const outcome: RecordOutcome | null = runner.lastOutcome;

      // The student skipped the listening step: drop this card without grading it.
      if (outcome === null) {
        this.test.skipCurrentCard();
        continue;
      }

      const again = outcome.kind === 'graded' && outcome.result.grade === 'again';
      const willRepeat =
        again && this.store.againMode() === 'now' && attempts < MAX_ATTEMPTS_PER_CARD;
      const text =
        outcome.kind === 'silent' && attempts >= 2
          ? "I didn't hear anything. Moving on."
          : resultSpeech(outcome, willRepeat);
      const spoke = await runner.run([{ kind: 'speak', text, label: 'Result' }]);
      if (spoke === 'stopped') return 'stopped';

      if (outcome.kind === 'unavailable') {
        this.finish('The microphone is not available, so Test coach stopped.');
        return 'no-mic';
      }
      if (outcome.kind === 'failed') this.test.skipCurrentCard();
      if (outcome.kind === 'silent' && attempts >= 2) this.test.skipCurrentCard();
      if (again && this.store.againMode() === 'now' && attempts >= MAX_ATTEMPTS_PER_CARD) {
        this.test.skipCurrentCard();
      }

      // A pause before the next card; "Hear it" reads the verse back during it.
      if ((await this.pauseBetweenCards(runner)) === 'stopped') return 'stopped';
    }
    return runner.isStopped ? 'stopped' : 'deck-done';
  }

  private async pauseBetweenCards(runner: CoachRunner): Promise<'ok' | 'stopped'> {
    if (this.store.deckComplete()) return 'ok';
    // "Hear it" may already have been pressed while the result was being spoken: skip the wait then.
    if (!this.hearItRequested) {
      const wait: CoachStep = {
        kind: 'wait',
        ms: this.prefs().continueMs,
        label: 'Next card soon. Tap "Hear it" for the verse.',
      };
      if ((await runner.run([wait])) === 'stopped') return 'stopped';
    }
    if (this.hearItRequested) {
      this.hearItRequested = false;
      const verse = this.lastVerse();
      if (verse) {
        const r = await runner.run([
          { kind: 'speak', text: verse, label: 'Here is the verse' },
          { kind: 'wait', ms: 1500, label: 'Next card soon' },
        ]);
        if (r === 'stopped') return 'stopped';
      }
    }
    return 'ok';
  }
}
