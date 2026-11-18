import { computed, inject, Injectable, signal } from '@angular/core';
import { MemorizationLearnProgress } from '../models';
import { clozeMatches } from './chunking';
import { Grade } from './srs';
import { markLearned, unmarkLearned, unlockNext, markDone, initialLearn } from './learn';
import { LearnStage, MemorizeStore } from './memorize-store';

/**
 * Learn mode actions and the Fill stage's typed answers. Reads and writes the page's `MemorizeStore`
 * (chunks, progress, saving); provided by `MemorizeViewComponent` next to it.
 */
@Injectable()
export class MemorizeLearn {
  private readonly store = inject(MemorizeStore);

  setLearnStage(stage: LearnStage): void {
    this.store.learnStage.set(stage);
    this.store.learnFillRevealed.set(false);
    if (stage !== 'recite') {
      this.store.learnRevealed.set(false);
      this.store.resetTestCard();
    }
  }

  toggleLearnFill(): void {
    this.store.learnFillRevealed.update((r) => !r);
  }

  // --- Fill stage: typed answers ---

  /** Answers are kept per chunk, verse and blank size: changing any of them starts a clean slate. */
  private readonly learnFillKey = computed(
    () =>
      `${this.store.learnIndex()}:${this.store.learnProgress().unlocked}:${this.store.clozeN()}`,
  );

  private readonly learnFillState = signal<{
    key: string;
    typed: Record<number, string>;
    result: Record<number, boolean>;
  }>({ key: '', typed: {}, result: {} });

  /** What the student typed into each blank, by token index. */
  readonly learnFillTyped = computed(() => {
    const s = this.learnFillState();
    return s.key === this.learnFillKey() ? s.typed : {};
  });

  /** Right or wrong for each blank that has been checked, by token index. */
  readonly learnFillResult = computed<Record<number, boolean>>(() => {
    const s = this.learnFillState();
    return s.key === this.learnFillKey() ? s.result : {};
  });

  /** Blank numbers (1-based) by token index, for the "Blank 3 of 9" labels. */
  readonly learnFillBlankNumbers = computed(() => {
    const numbers: Record<number, number> = {};
    let n = 0;
    this.store.learnFillTokens().forEach((t, i) => {
      if (t.blank) numbers[i] = ++n;
    });
    return numbers;
  });

  /** How many blanks there are, and how many were right the last time the student checked. */
  readonly learnFillScore = computed(() => {
    const result = this.learnFillResult();
    const checked = Object.keys(result).length > 0;
    return {
      total: this.store.learnFillTokens().filter((t) => t.blank).length,
      correct: Object.values(result).filter(Boolean).length,
      checked,
    };
  });

  learnFillTypedAt(index: number): string {
    return this.learnFillTyped()[index] ?? '';
  }

  /** Record a typed answer. Editing a blank clears its right-or-wrong mark until the next check. */
  setLearnFillTyped(index: number, value: string): void {
    const key = this.learnFillKey();
    this.learnFillState.update((s) => {
      const base = s.key === key ? s : { key, typed: {}, result: {} };
      const result = { ...base.result };
      delete result[index];
      return { key, typed: { ...base.typed, [index]: value }, result };
    });
  }

  /** Mark every blank right or wrong against the verse. Entirely client-side; answers stay hidden. */
  checkLearnFill(): void {
    const key = this.learnFillKey();
    const typed = this.learnFillTyped();
    const result: Record<number, boolean> = {};
    this.store.learnFillTokens().forEach((tok, i) => {
      if (tok.blank) result[i] = clozeMatches(typed[i] ?? '', tok.text);
    });
    this.learnFillState.update((s) => ({ key, typed: s.key === key ? s.typed : {}, result }));
  }

  revealLearn(): void {
    this.store.learnRevealed.set(true);
  }

  /** Write new Learn progress onto the chunk and persist via the existing save path. */
  private commitLearn(index: number, learn: MemorizationLearnProgress): void {
    this.store.chunks.update((cs) => cs.map((c, i) => (i === index ? { ...c, learn } : c)));
    this.store.save();
  }

  /** "Got it": the newest unlocked verse (cumulative range) is learned. Never unlocks by itself. */
  learnGotIt(): void {
    const i = this.store.learnIndex();
    if (i < 0 || this.store.saving()) return;
    this.commitLearn(i, markLearned(this.store.learnProgress()));
    this.store.learnRevealed.set(false);
    this.store.resetTestCard();
  }

  /** "Not yet": back to reading the verse; it stays unlearned. */
  learnNotYet(): void {
    const i = this.store.learnIndex();
    if (i < 0 || this.store.saving()) return;
    this.commitLearn(i, unmarkLearned(this.store.learnProgress()));
    this.setLearnStage('read');
  }

  /** Explicitly unlock the next verse (allowed even if the current one is not marked learned). */
  learnUnlockNext(): void {
    const i = this.store.learnIndex();
    if (i < 0 || this.store.saving()) return;
    this.commitLearn(i, unlockNext(this.store.learnProgress(), this.store.learnVerses().length));
    this.setLearnStage('read');
  }

  /**
   * Grade the whole chunk once every verse is learned. Runs the existing SM-2 path (one save that
   * carries both the schedule and the Learn progress). "Again" is a miss: the last verse goes back
   * to unlearned and the student recites the chunk again; any pass marks the chunk done.
   */
  learnGrade(g: Grade): void {
    const i = this.store.learnIndex();
    if (i < 0 || this.store.saving() || !this.store.learnReady()) return;
    const progress = this.store.learnProgress();
    const learn = g === 'again' ? unmarkLearned(progress) : markDone(progress);
    this.store.chunks.update((cs) => cs.map((c, idx) => (idx === i ? { ...c, learn } : c)));
    this.store.activeIndex.set(i);
    this.store.grade(g); // applyGrade + a single save
    this.store.learnStage.set('recite');
    this.store.learnRevealed.set(false);
    this.store.resetTestCard();
  }

  learnNextChunk(): void {
    const idx = this.store.learnNextIndex();
    if (idx >= 0) this.store.selectLearnChunk(idx);
  }

  /** Start this chunk's Learn run over. The SM-2 schedule is left alone. */
  learnRelearn(): void {
    const i = this.store.learnIndex();
    if (i < 0 || this.store.saving()) return;
    this.commitLearn(i, initialLearn());
    this.store.selectLearnChunk(i);
  }

  // --- Test mode (spoken-recitation auto-grade) ---
}
