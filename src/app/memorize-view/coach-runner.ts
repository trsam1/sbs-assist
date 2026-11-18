import { CoachStep, RecordOutcome } from './coach-plan';

/** The browser-facing pieces a coaching session needs. Tests replace all of them. */
export interface CoachPorts {
  /** Speak `text`. Resolves when it has been spoken; rejects with an Error if speech failed. */
  speak(text: string): Promise<void>;
  /** Stop any speech in progress. A pending `speak` may resolve or reject afterwards; the runner ignores it. */
  cancelSpeech(): void;
  /** A short tone that marks "now". */
  tone(): Promise<void>;
  /** Listen to a recitation and grade it. */
  record(): Promise<RecordOutcome>;
  /** Stop listening and discard whatever was recorded. */
  cancelRecord(): void;
}

export interface CoachHooks {
  /** A step is about to run. `index` and `total` are within the list passed to `run`. */
  onStep?(step: CoachStep, index: number, total: number): void;
  /** Speech failed. The runner pauses on the same step so the student can resume. */
  onSpeechError?(error: Error): void;
  /** Pause state changed. */
  onPausedChange?(paused: boolean): void;
}

export type RunResult = 'done' | 'stopped';

type Control = 'skip' | 'pause' | 'stop' | 'repeat';

class StopSignal extends Error {}

/**
 * Runs a list of coaching steps one at a time. Supports pause (restarts the same step on resume), skip,
 * repeat (back to the previous spoken step) and stop. A `generation` counter makes anything that finishes
 * after it was cancelled inert.
 */
export class CoachRunner {
  /** The result of the most recent `record` step. */
  lastOutcome: RecordOutcome | null = null;

  private stopped = false;
  private paused = false;
  private generation = 0;
  private ctrl: ((c: Control) => void) | null = null;
  private resumeWaiters: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDone: (() => void) | null = null;

  constructor(
    private readonly ports: CoachPorts,
    private readonly hooks: CoachHooks = {},
  ) {}

  get isPaused(): boolean {
    return this.paused;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** Run `steps` in order. Resolves 'stopped' if `stop()` was called, otherwise 'done'. */
  async run(steps: readonly CoachStep[]): Promise<RunResult> {
    if (this.stopped) return 'stopped';
    let i = 0;
    try {
      while (i < steps.length) {
        this.hooks.onStep?.(steps[i], i, steps.length);
        const control = await this.exec(steps[i]);
        if (control === 'repeat') {
          i = this.previousSpeak(steps, i);
        } else {
          i += 1;
        }
      }
      return 'done';
    } catch (e) {
      if (e instanceof StopSignal) return 'stopped';
      throw e;
    }
  }

  pause(): void {
    if (this.stopped || this.paused) return;
    this.paused = true;
    this.hooks.onPausedChange?.(true);
    this.ctrl?.('pause');
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.hooks.onPausedChange?.(false);
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((w) => w());
  }

  /** Jump to the next step. */
  skip(): void {
    this.ctrl?.('skip');
  }

  /** Go back to the last spoken step and say it again. */
  repeat(): void {
    this.ctrl?.('repeat');
  }

  /** End the session now. Everything in flight is cancelled and later `run` calls return 'stopped'. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.cancelCurrent();
    this.ctrl?.('stop');
    this.resumeWaiters.forEach((w) => w());
    this.resumeWaiters = [];
    if (this.paused) {
      this.paused = false;
      this.hooks.onPausedChange?.(false);
    }
  }

  // --- internals ----------------------------------------------------------------------------------

  /** Repeat: replay the current step if it is speech, else the nearest earlier spoken step. */
  private previousSpeak(steps: readonly CoachStep[], from: number): number {
    for (let j = from; j >= 0; j -= 1) {
      if (steps[j].kind === 'speak') return j;
    }
    return from; // nothing spoken yet: run this step again
  }

  /** Start the step's work. The promise resolves when the work finishes on its own. */
  private start(step: CoachStep): Promise<void> {
    const gen = this.generation;
    const token = ++this.stepToken;
    switch (step.kind) {
      case 'speak':
        return this.ports.speak(step.text).catch((err: unknown) => {
          if (gen !== this.generation || this.ctrlPending) throw new CancelledQuietly();
          throw err instanceof Error ? err : new Error('Speech failed');
        });
      case 'tone':
        return this.ports.tone().catch(() => undefined);
      case 'wait':
        return new Promise<void>((resolve) => {
          this.timerDone = resolve;
          this.timer = setTimeout(() => {
            this.timer = null;
            this.timerDone = null;
            resolve();
          }, step.ms);
        });
      case 'record':
        this.lastOutcome = null;
        return this.ports.record().then((o) => {
          if (gen === this.generation && token === this.stepToken) this.lastOutcome = o;
        });
    }
  }

  private ctrlPending = false;
  private stepToken = 0;

  private cancelCurrent(): void {
    this.stepToken += 1; // anything still in flight for the old step is now stale
    this.ports.cancelSpeech();
    this.ports.cancelRecord();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timerDone = null;
  }

  /** Run one step to completion, handling pause (restart on resume), skip, repeat and stop. */
  private async exec(step: CoachStep): Promise<'next' | 'repeat'> {
    for (;;) {
      if (this.stopped) throw new StopSignal();
      if (this.paused) {
        await this.waitForResume();
        continue;
      }
      this.ctrlPending = false;
      const work = this.start(step).then(
        () => 'finished' as const,
        (err: unknown) =>
          err instanceof CancelledQuietly ? ('cancelled' as const) : (err as Error),
      );
      const control = new Promise<Control>((resolve) => {
        this.ctrl = (c) => {
          this.ctrlPending = true;
          resolve(c);
        };
      });

      const winner = await Promise.race([work, control]);
      this.ctrl = null;

      if (winner === 'finished') return 'next';
      if (winner instanceof Error) {
        // Speech failed on its own: pause on this step and tell the student.
        this.hooks.onSpeechError?.(winner);
        this.paused = true;
        this.hooks.onPausedChange?.(true);
        continue;
      }
      if (winner === 'cancelled') {
        // Something cancelled the work without a control signal arriving first; treat as finished.
        if (this.stopped) throw new StopSignal();
        return 'next';
      }

      // A control signal beat the step: cancel what is running, then act.
      this.cancelCurrent();
      if (winner === 'stop') throw new StopSignal();
      if (winner === 'skip') return 'next';
      if (winner === 'repeat') return 'repeat';
      // pause: loop; the paused check at the top waits for resume and restarts this step.
    }
  }

  private waitForResume(): Promise<void> {
    return new Promise((resolve) => this.resumeWaiters.push(resolve));
  }
}

/** Marks speech that was cancelled on purpose, so it is not reported as a failure. */
class CancelledQuietly extends Error {}
