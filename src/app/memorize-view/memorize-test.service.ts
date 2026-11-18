import { inject, Injectable } from '@angular/core';
import { RecitationGradeService } from '../recitation-grade.service';
import { RecitationGradeValue } from '../models';
import { RecordOutcome } from './coach-plan';
import { SILENCE_WATCHER, SilenceOptions } from './coach-ports';
import { MemorizeStore } from './memorize-store';

/**
 * Recording and grading a spoken recitation: the Record button, audio coaching's listen-and-grade, and
 * committing a grade in Test mode. Reads and writes the page's `MemorizeStore`; provided by
 * `MemorizeViewComponent` next to it.
 */
@Injectable()
export class MemorizeTest {
  private readonly store = inject(MemorizeStore);

  private readonly recitationGrade = inject(RecitationGradeService);

  private mediaRecorder: MediaRecorder | null = null;

  private recordedChunks: Blob[] = [];

  private mediaStream: MediaStream | null = null;

  private recordStopTimer: ReturnType<typeof setTimeout> | null = null;

  // Audio coaching hooks (see recordAndGrade): who is waiting on the result, a cancel counter for a
  // recording that is still opening, whether to throw the clip away, and the silence watcher.
  private readonly watchSilence = inject(SILENCE_WATCHER);

  private recordWaiter: ((o: RecordOutcome) => void) | null = null;

  private recordToken = 0;

  private discardNext = false;

  private stopSilenceWatch: (() => void) | null = null;

  /** Max recitation length (ms) before recording auto-stops. */
  private static readonly MAX_RECORD_MS = 60_000;

  /** True when the browser can record audio (MediaRecorder + getUserMedia). Testable seam. */
  recordingSupported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  /** Human label for a grade value (for the result tag). */
  gradeLabel(g?: RecitationGradeValue): string {
    switch (g) {
      case 'again':
        return 'Again';
      case 'hard':
        return 'Hard';
      case 'good':
        return 'Good';
      case 'easy':
        return 'Easy';
      default:
        return '';
    }
  }

  /** Begin recording the recitation. On any failure, degrade to manual grading. */
  async startRecording(opts?: { autoStop?: Partial<SilenceOptions> }): Promise<void> {
    if (!this.recordingSupported()) {
      this.settleRecord({ kind: 'unavailable' });
      return;
    }
    if (this.store.gradeTarget() === 'test' && this.store.deckComplete()) {
      this.settleRecord({ kind: 'unavailable' });
      return;
    }
    this.store.testError.set(false);
    this.store.gradeResult.set(null);
    const token = ++this.recordToken;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== this.recordToken) {
        // Cancelled while the permission prompt or device was opening: let go of the microphone.
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.mediaStream = stream;
      this.recordedChunks = [];
      const recorder = new MediaRecorder(stream);
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };
      recorder.onstop = () => this.onRecordingStopped();
      recorder.start();
      this.store.testPhase.set('recording');
      // Safety cap: auto-stop a runaway recording.
      this.recordStopTimer = setTimeout(() => this.stopRecording(), MemorizeTest.MAX_RECORD_MS);
      if (opts?.autoStop) {
        // Audio coaching: end the recording when the student goes quiet, or give up if they never start.
        this.stopSilenceWatch = this.watchSilence(stream, opts.autoStop, (why) =>
          why === 'silence' ? this.stopRecording() : this.discardRecording(),
        );
      }
    } catch {
      // Permission denied / no device: fall back to manual grading for this card.
      this.teardownStream();
      this.store.testError.set(true);
      this.store.testPhase.set('idle');
      this.settleRecord({ kind: 'unavailable' });
    }
  }

  /** Stop recording; the recorder's onstop handler runs the grade flow. */
  stopRecording(): void {
    this.endSilenceWatch();
    if (this.recordStopTimer) {
      clearTimeout(this.recordStopTimer);
      this.recordStopTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  /** Stop recording and throw the clip away: nothing is graded. */
  discardRecording(): void {
    this.discardNext = true;
    this.stopRecording();
  }

  /**
   * Audio coaching: listen to one recitation and grade it. Resolves with what happened. The grade is
   * applied exactly as in Test mode's Drive mode (auto-commit); the result is returned first, before the
   * deck moves on, so it can be spoken.
   */
  recordAndGrade(autoStop: Partial<SilenceOptions>): Promise<RecordOutcome> {
    return new Promise<RecordOutcome>((resolve) => {
      this.settleRecord({ kind: 'unavailable' }); // a stale waiter never hangs
      this.recordWaiter = resolve;
      void this.startRecording({ autoStop });
    });
  }

  /** Stop an in-progress coached recording without grading it. Safe to call at any time. */
  cancelCoachedRecording(): void {
    if (!this.recordWaiter && !this.mediaRecorder) return; // nothing coached is in progress
    this.recordToken += 1; // a recording still opening will release the microphone when it arrives
    this.recordWaiter = null;
    this.endSilenceWatch();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.discardNext = true;
      this.stopRecording();
    } else {
      this.teardownStream();
      this.store.testPhase.set('idle');
    }
  }

  /** Drop the current Test card without grading it and move to the next. */
  skipCurrentCard(): void {
    if (this.store.deckComplete()) return;
    this.store.advanceDeck();
    this.store.resetTestCard();
  }

  private settleRecord(outcome: RecordOutcome): void {
    const waiter = this.recordWaiter;
    this.recordWaiter = null;
    waiter?.(outcome);
  }

  private endSilenceWatch(): void {
    this.stopSilenceWatch?.();
    this.stopSilenceWatch = null;
  }

  /** Assemble the clip and send it for grading. */
  private onRecordingStopped(): void {
    this.teardownStream();
    const type = this.mediaRecorder?.mimeType || 'audio/webm';
    const clip = new Blob(this.recordedChunks, { type });
    this.recordedChunks = [];
    this.mediaRecorder = null;
    if (this.discardNext) {
      this.discardNext = false;
      this.store.testPhase.set('idle');
      this.settleRecord({ kind: 'silent' });
      return;
    }
    if (clip.size === 0) {
      this.store.testError.set(true);
      this.store.testPhase.set('idle');
      this.settleRecord({ kind: 'silent' });
      return;
    }
    this.gradeClip(clip);
  }

  /** Send the recorded clip to the grade service, then apply per drive/desk mode. */
  private gradeClip(clip: Blob): void {
    this.store.testPhase.set('grading');
    const learning = this.store.gradeTarget() === 'learn';
    const chunkText = this.store.gradeReferenceText();
    const reference = learning ? (this.store.learnChunk()?.verseRef ?? '') : this.store.cardRef();
    this.recitationGrade.gradeRecitation(clip, chunkText, reference).subscribe({
      next: (result) => {
        this.store.gradeResult.set(result);
        this.store.testPhase.set('graded');
        // Hand the result to a coached session before the grade commits and the deck moves on.
        this.settleRecord({ kind: 'graded', result });
        if (learning) {
          // Learn: show the result only. It never writes the SM-2 schedule.
          this.store.learnRevealed.set(true);
          return;
        }
        // Drive mode: auto-commit the computed grade and advance — no screen touch.
        if (this.store.testDriveMode() === 'drive') {
          this.commitTestGrade(result.grade);
        }
      },
      error: () => {
        // Service failure: let the student self-grade with the manual buttons.
        this.store.testError.set(true);
        this.store.gradeResult.set(null);
        this.store.testPhase.set('graded');
        this.settleRecord({ kind: 'failed' });
        if (learning) this.store.learnRevealed.set(true);
      },
    });
  }

  /** Commit a grade (confirmed, overridden, or auto in drive mode) and handle the deck move. */
  commitTestGrade(g: RecitationGradeValue): void {
    if (this.store.deckComplete() || this.store.saving()) return;
    const cardIndex = this.store.currentCardIndex();
    if (cardIndex < 0) return;
    this.store.syncActiveToCard();
    this.store.grade(g); // existing SM-2 path (schedule only)

    if (g === 'again' && this.store.againMode() === 'now') {
      // Redo now: stay on the same verse, reset the test card to record again.
      this.store.resetTestCard();
      return;
    }
    if (g === 'again') {
      this.store.requeueCurrent(cardIndex);
    }
    this.store.advanceDeck();
    this.store.resetTestCard();
  }

  /** Stop any live mic stream and release the device. */
  private teardownStream(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
  }
}
