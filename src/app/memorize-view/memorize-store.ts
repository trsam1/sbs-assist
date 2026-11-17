import { computed, inject, Injectable, signal } from '@angular/core';
import { ScrollToolContext } from '../tool-shell/scroll-tool-context';
import { ActivatedRoute } from '@angular/router';
import { MemorizationStudyService } from '../memorization-study.service';
import { RecitationGradeService } from '../recitation-grade.service';
import { OutlineStudyService } from '../outline-study.service';
import {
  MemorizationChunk,
  MemorizationChunkState,
  MemorizationLearnProgress,
  MemorizationReminderPref,
  OutlineParagraph,
  RecitationGradeResult,
  RecitationGradeValue,
} from '../models';
import {
  seedByVerses,
  seedFromParagraphs,
  findVerseMarkers,
  chunkText,
  chunkOutOfRange,
  firstLetters,
  blankEveryNth,
  clozeMatches,
  ClozeToken,
  VERSE_REF_MAX,
  DEFAULT_VERSES_PER_CHUNK,
  VERSES_PER_CHUNK_MIN,
  VERSES_PER_CHUNK_MAX,
} from './chunking';
import {
  readSchedule,
  isDue,
  applyGrade,
  dueLabel,
  deriveState,
  selectDeck,
  DEFAULT_NEW_PER_DAY,
  NEW_PER_DAY_MIN,
  NEW_PER_DAY_MAX,
  LearnedState,
  Grade,
} from './srs';
import { reciteDiff, ReciteDiff } from './recite-diff';
import {
  splitVerses,
  rangeText,
  clampLearn,
  markLearned,
  unmarkLearned,
  unlockNext,
  isReadyToGrade,
  markDone,
  nextChunkToLearn,
  initialLearn,
} from './learn';
import {
  classifySwipe,
  swipeToGrade,
  keyToGrade,
  isFlipKey,
  DEFAULT_SWIPE_OPTIONS,
} from './gestures';

type ViewMode = 'learn' | 'review' | 'test' | 'edit';
type LearnStage = 'read' | 'fill' | 'recite';
type DrillMode = 'chain' | 'reveal' | 'cloze';
type RevealLevel = 'full' | 'first' | 'blank';

const STATE_LABELS: Record<MemorizationChunkState, string> = {
  new: 'New',
  learning: 'Learning',
  chained: 'Chained',
  solid: 'Solid',
};
const STATE_ORDER: MemorizationChunkState[] = ['new', 'learning', 'chained', 'solid'];

/**
 * All state and behavior for the Memorize page: chunks, drill, deck, Learn, Review, Test, preferences and
 * saving. Provided by `MemorizeViewComponent` so each page visit gets its own copy; the component and its
 * mode panes read it.
 */
@Injectable()
export class MemorizeStore {
  private readonly memorizationStudy = inject(MemorizationStudyService);
  private readonly recitationGrade = inject(RecitationGradeService);
  private readonly outlineStudy = inject(OutlineStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly ctx = inject(ScrollToolContext);
  readonly state = this.ctx.state;
  readonly study = this.ctx.study;

  readonly chunks = signal<MemorizationChunk[]>([]);

  // Seed state.
  readonly versesPerChunk = signal(DEFAULT_VERSES_PER_CHUNK);
  readonly outlineParagraphs = signal<OutlineParagraph[]>([]);
  readonly seedUnmapped = signal<number[]>([]);

  // Drill UI state (view-only, not persisted).
  readonly mode = signal<DrillMode>('chain');
  readonly activeIndex = signal(0);
  readonly revealLevel = signal<RevealLevel>('full');
  readonly clozeN = signal(3);
  readonly clozeRevealed = signal(false);
  readonly clozeTyped = signal<Record<number, string>>({});
  readonly clozeResult = signal<Record<number, boolean>>({});

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  // Daily reminder preference (opt-in, default off; per-user, not scroll-scoped).
  readonly reminderOptIn = signal(false);
  readonly reminderHour = signal<number | null>(null);
  readonly reminderError = signal('');

  // Review-mode flashcard state (transient, view-only, never persisted).
  readonly viewMode = signal<ViewMode>('edit');
  readonly deck = signal<number[]>([]); // session deck: chunk indices, built from dueQueue
  readonly deckPos = signal(0); // current card position within the deck
  readonly flipped = signal(false); // current card front/back
  readonly scaffold = signal<'none' | 'first'>('none'); // front first-letters hint
  readonly legendDismissed = signal(false); // shortcut legend shown until dismissed
  private swipeStart: { x: number; y: number } | null = null;

  // How many never-reviewed chunks are introduced into the deck per day (persisted per study as a
  // sentinel chunk; see loadSaved/save). Review chunks are never throttled — only new material is.
  readonly newPerDay = signal(DEFAULT_NEW_PER_DAY);
  // What "Again" does during a session: 'now' re-shows the same card immediately (drill it until it
  // sticks); 'later' requeues it a few cards back so it recurs soon without blocking the deck.
  readonly againMode = signal<'now' | 'later'>('now');

  // Test-mode (spoken-recitation auto-grade) state (transient, view-only, never persisted).
  readonly testDriveMode = signal<'desk' | 'drive'>('desk'); // default desk: nothing auto-commits
  readonly testPhase = signal<'idle' | 'recording' | 'grading' | 'graded'>('idle');
  readonly gradeResult = signal<RecitationGradeResult | null>(null);
  readonly testError = signal(false);
  /** Which mode a mic recitation belongs to: Test commits SM-2; Learn only shows the result. */
  readonly gradeTarget = signal<'test' | 'learn'>('test');

  // Learn-mode state. Progress itself lives on the chunk (persisted); these are transient view state.
  readonly learnIndex = signal(-1);
  readonly learnStage = signal<LearnStage>('read');
  readonly learnRevealed = signal(false);
  readonly learnFillRevealed = signal(false);
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private mediaStream: MediaStream | null = null;
  private recordStopTimer: ReturnType<typeof setTimeout> | null = null;
  /** Max recitation length (ms) before recording auto-stops. */
  private static readonly MAX_RECORD_MS = 60_000;

  readonly VERSE_REF_MAX = VERSE_REF_MAX;
  readonly VERSES_PER_CHUNK_MIN = VERSES_PER_CHUNK_MIN;
  readonly VERSES_PER_CHUNK_MAX = VERSES_PER_CHUNK_MAX;
  readonly NEW_PER_DAY_MIN = NEW_PER_DAY_MIN;
  readonly NEW_PER_DAY_MAX = NEW_PER_DAY_MAX;
  readonly stateLabels = STATE_LABELS;
  readonly stateOrder = STATE_ORDER;

  scrollStudyId = '';

  private scrollText(): string {
    return this.study()?.scrollText ?? '';
  }

  /** True when the scroll carries at least one verse marker (enables the by-verses seed). */
  readonly hasVerseMarkers = computed(() => findVerseMarkers(this.scrollText()).length > 0);

  readonly progressLabel = computed(() => {
    const cs = this.chunks();
    const solid = cs.filter((c) => deriveState(c) === 'solid').length;
    return `${solid} of ${cs.length} chunks solid`;
  });

  /** The DERIVED learned-state for each chunk (earned from the SM-2 schedule, not set by hand). */
  readonly chunkStates = computed<LearnedState[]>(() => this.chunks().map((c) => deriveState(c)));

  /** Count of never-reviewed ("new") chunks — what the new-per-day limit meters. */
  readonly newChunkCount = computed(
    () => this.chunks().filter((c) => deriveState(c) === 'new').length,
  );

  readonly activeText = computed(() => {
    const cs = this.chunks();
    const i = this.activeIndex();
    if (i < 0 || i >= cs.length) return '';
    return chunkText(this.scrollText(), cs[i]);
  });

  /** The accumulated run: chunks 0..activeIndex joined in order (chain-and-chain). */
  readonly chainRun = computed(() => {
    const cs = this.chunks();
    const i = Math.min(this.activeIndex(), cs.length - 1);
    const text = this.scrollText();
    return cs
      .slice(0, i + 1)
      .map((c) => chunkText(text, c))
      .join('\n');
  });

  readonly revealText = computed(() => {
    const text = this.activeText();
    switch (this.revealLevel()) {
      case 'full':
        return text;
      case 'first':
        return firstLetters(text);
      case 'blank':
        return firstLetters(text).replace(/[^\s_]/g, '_');
    }
  });

  readonly clozeTokens = computed<ClozeToken[]>(() =>
    blankEveryNth(this.activeText(), this.clozeN()),
  );

  /**
   * "Today" for all SM-2 date math, read once at construction (local date-only). Grading reads it
   * live via a getter so a long-open session still schedules against the current day; the helpers
   * take it as an argument so the math stays pure and testable. Overridable in tests via `setToday`.
   */
  private readonly todayValue = signal(new Date());
  today(): Date {
    return this.todayValue();
  }
  /** Test seam: pin "today" so the due-queue / grade math is deterministic under test. */
  setToday(d: Date): void {
    this.todayValue.set(d);
  }

  /** The chunks due for review today, soonest-due first then by chunk order (derived, not saved). */
  readonly dueQueue = computed(() => {
    const today = this.today();
    return this.chunks()
      .map((c, index) => ({ chunk: c, index, schedule: readSchedule(c) }))
      .filter((row) => isDue(row.schedule, today))
      .sort((a, b) => {
        // soonest due first (empty dueDate = never reviewed = earliest), then chunk order
        const ad = a.schedule.dueDate || '';
        const bd = b.schedule.dueDate || '';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return a.index - b.index;
      })
      .map((row) => ({
        index: row.index,
        verseRef: row.chunk.verseRef,
        dueLabel: dueLabel(row.schedule, today),
      }));
  });

  readonly dueCount = computed(() => this.dueQueue().length);

  /** The next-due label for the active chunk (e.g. "due today" / "due in 6 days"). */
  readonly activeDueLabel = computed(() => {
    const cs = this.chunks();
    const i = this.activeIndex();
    if (i < 0 || i >= cs.length) return '';
    return dueLabel(readSchedule(cs[i]), this.today());
  });

  // --- Review-mode (flashcard deck) derived state ---

  /** The chunk index for the current card, or -1 when the deck is complete/empty. */
  readonly currentCardIndex = computed(() => {
    const d = this.deck();
    const pos = this.deckPos();
    return pos >= 0 && pos < d.length ? d[pos] : -1;
  });

  /** Deck progress for the aria-live indicator. */
  readonly deckProgress = computed(() => ({ pos: this.deckPos(), total: this.deck().length }));

  /** True when the deck has been worked through (nothing left to review this session). */
  readonly deckComplete = computed(() => this.deckPos() >= this.deck().length);

  /** The current card's reference label (empty when unlabeled → the template shows "Chunk K"). */
  readonly cardRef = computed(() => {
    const i = this.currentCardIndex();
    const cs = this.chunks();
    return i >= 0 && i < cs.length ? (cs[i].verseRef ?? '') : '';
  });

  /** The current card's 1-based chunk number (for the "Chunk K" fallback label). */
  readonly cardChunkNumber = computed(() => this.currentCardIndex() + 1);

  /** The current card's full text (student's own scroll), shown on the back. */
  readonly cardBackText = computed(() => {
    const i = this.currentCardIndex();
    const cs = this.chunks();
    if (i < 0 || i >= cs.length) return '';
    return chunkText(this.scrollText(), cs[i]);
  });

  /**
   * Word-level highlight of the last graded recitation: which verse words were missed and which
   * spoken words were not in the verse. Null when there is no usable transcript (degraded grade
   * or no result), so the view never flags every word as missed.
   */
  readonly reciteDiff = computed<ReciteDiff | null>(() => {
    const transcript = this.gradeResult()?.transcript?.trim();
    if (!transcript) return null;
    return reciteDiff(this.gradeReferenceText(), transcript);
  });

  /** Count of verse words the student missed, for the summary line. */
  readonly reciteMissedCount = computed(
    () => this.reciteDiff()?.verse.filter((t) => !t.matched).length ?? 0,
  );

  // --- Learn-mode derived state ---

  /** The chunk being learned, or null when none is selected / the index is stale. */
  readonly learnChunk = computed(() => {
    const i = this.learnIndex();
    const cs = this.chunks();
    return i >= 0 && i < cs.length ? cs[i] : null;
  });

  /** The chunk's verses, split from the student's own scroll. */
  readonly learnVerses = computed(() => {
    const c = this.learnChunk();
    return c ? splitVerses(this.scrollText(), c) : [];
  });

  /** Stored Learn progress clamped to the current verse count (fresh when none stored). */
  readonly learnProgress = computed(() =>
    clampLearn(this.learnChunk()?.learn, this.learnVerses().length),
  );

  /** Verses 1..unlocked joined: what the cumulative Recite stage tests. */
  readonly learnRangeText = computed(() =>
    rangeText(this.learnVerses(), this.learnProgress().unlocked),
  );

  /** The current (newest unlocked) verse, blanked for the Fill stage. */
  readonly learnFillTokens = computed<ClozeToken[]>(() => {
    const v = this.learnVerses()[this.learnProgress().unlocked - 1];
    return v ? blankEveryNth(v.text, this.clozeN()) : [];
  });

  readonly learnReady = computed(() =>
    isReadyToGrade(this.learnProgress(), this.learnVerses().length),
  );

  /** The next chunk worth learning, or -1. */
  readonly learnNextIndex = computed(() => nextChunkToLearn(this.chunks(), this.chunkStates()));

  /** The text a mic recitation is graded against: the Learn range, or the Test card. */
  readonly gradeReferenceText = computed(() =>
    this.gradeTarget() === 'learn' ? this.learnRangeText() : this.cardBackText(),
  );

  /** First-letters scaffold for the current card's text (front hint). */
  readonly cardScaffoldText = computed(() => firstLetters(this.cardBackText()));

  init(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.loadPrefs();
    this.load();
  }

  load(): void {
    this.ctx.load(this.scrollStudyId, {
      onStart: () => {
        this.saved.set(false);
        this.saveError.set(false);
      },
      onReady: () => {
        this.loadSaved();
        this.loadOutline();
        this.loadReminderPref();
      },
    });
  }

  /** Fetch the saved study (if any). A 404 means "none yet" → empty worksheet with a seed action. */
  private loadSaved(): void {
    this.memorizationStudy.get(this.scrollStudyId).subscribe({
      next: (saved) => {
        this.chunks.set(saved.chunks);
        this.buildDeck();
        // Land in Learn when a chunk is mid-way through its Learn run.
        const inProgress = saved.chunks.findIndex((c) => c.learn !== undefined && !c.learn.done);
        if (inProgress >= 0) {
          this.selectLearnChunk(inProgress);
          this.setViewMode('learn');
        }
      },
      error: () => {
        // 404 (none yet) or transient: leave the empty worksheet in place.
      },
    });
  }

  /** Fetch the Step 8 outline (if any) so the "seed from paragraphs" action can be offered. */
  private loadOutline(): void {
    this.outlineStudy.get(this.scrollStudyId).subscribe({
      next: (outline) => {
        this.outlineParagraphs.set(outline.paragraphs ?? []);
      },
      error: () => {
        // 404 (no outline yet) or transient: leave paragraphs empty → Step 8 seed not offered.
      },
    });
  }

  /** Fetch the per-user daily-reminder preference (defaults to off when unset). */
  private loadReminderPref(): void {
    this.memorizationStudy.getReminderPref().subscribe({
      next: (pref) => {
        this.reminderOptIn.set(pref.reminderOptIn === true);
        this.reminderHour.set(pref.reminderHour ?? null);
      },
      error: () => {
        // Transient: leave the default-off state in place.
      },
    });
  }

  /** Toggle the daily reminder opt-in and persist the preference. */
  setReminderOptIn(optIn: boolean): void {
    this.reminderOptIn.set(optIn);
    this.saveReminderPref();
  }

  /** Set the preferred reminder hour (0–23); clamps out-of-range input, then persists. */
  setReminderHour(hour: number | string): void {
    const n = typeof hour === 'number' ? hour : parseInt(hour, 10);
    if (Number.isNaN(n)) {
      this.reminderHour.set(null);
    } else {
      this.reminderHour.set(Math.max(0, Math.min(23, Math.trunc(n))));
    }
    this.saveReminderPref();
  }

  /** Persist the current reminder preference; a failure surfaces an inline error, state is kept. */
  private saveReminderPref(): void {
    this.reminderError.set('');
    const hour = this.reminderHour();
    const pref: MemorizationReminderPref = {
      reminderOptIn: this.reminderOptIn(),
      ...(this.reminderOptIn() && hour !== null ? { reminderHour: hour } : {}),
    };
    this.memorizationStudy.putReminderPref(pref).subscribe({
      next: (saved) => {
        this.reminderOptIn.set(saved.reminderOptIn === true);
        this.reminderHour.set(saved.reminderHour ?? null);
      },
      error: () => {
        this.reminderError.set('Could not save the reminder preference. Please try again.');
      },
    });
  }

  // --- chunk editing ---

  setVersesPerChunk(n: number): void {
    this.versesPerChunk.set(
      Math.max(
        VERSES_PER_CHUNK_MIN,
        Math.min(VERSES_PER_CHUNK_MAX, Math.floor(n || DEFAULT_VERSES_PER_CHUNK)),
      ),
    );
  }

  /** Seed by grouping every N verse markers into a chunk. No-op if the scroll has no markers. */
  seedByVerseCount(): void {
    const seeded = seedByVerses(this.scrollText(), this.versesPerChunk());
    this.chunks.set(seeded);
    this.seedUnmapped.set([]);
    this.activeIndex.set(0);
  }

  /** Seed one chunk per Step 8 paragraph, mapping each paragraph's refs to scroll offsets. */
  seedFromOutline(): void {
    const { chunks, unmapped } = seedFromParagraphs(this.scrollText(), this.outlineParagraphs());
    this.chunks.set(chunks);
    this.seedUnmapped.set(unmapped);
    this.activeIndex.set(0);
  }

  removeChunk(index: number): void {
    this.chunks.update((cs) => cs.filter((_, i) => i !== index));
    this.clampActive();
  }

  moveUp(index: number): void {
    if (index <= 0) return;
    this.chunks.update((cs) => {
      const next = [...cs];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  /** Merge a chunk into the one above it (union of ranges; keeps the upper chunk's label/state). */
  mergeUp(index: number): void {
    if (index <= 0) return;
    this.chunks.update((cs) => {
      const next = [...cs];
      const above = next[index - 1];
      const here = next[index];
      next[index - 1] = {
        ...above,
        start: Math.min(above.start, here.start),
        end: Math.max(above.end, here.end),
      };
      next.splice(index, 1);
      return next;
    });
    this.clampActive();
  }

  setVerseRef(index: number, value: string): void {
    this.chunks.update((cs) => cs.map((c, i) => (i === index ? { ...c, verseRef: value } : c)));
  }

  setState(index: number, value: MemorizationChunkState): void {
    this.chunks.update((cs) => cs.map((c, i) => (i === index ? { ...c, state: value } : c)));
  }

  preview(index: number): string {
    const text = chunkText(this.scrollText(), this.chunks()[index]);
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
  }

  outOfRange(index: number): boolean {
    return chunkOutOfRange(this.scrollText(), this.chunks()[index]);
  }

  private clampActive(): void {
    const len = this.chunks().length;
    if (this.activeIndex() >= len) this.activeIndex.set(Math.max(0, len - 1));
  }

  // --- drill controls (view-only) ---

  setMode(mode: DrillMode): void {
    this.mode.set(mode);
  }

  setActive(index: number): void {
    this.activeIndex.set(index);
    this.clozeTyped.set({});
    this.clozeResult.set({});
    this.clozeRevealed.set(false);
  }

  setReveal(level: RevealLevel): void {
    this.revealLevel.set(level);
  }

  setClozeN(n: number): void {
    this.clozeN.set(Math.max(2, Math.min(10, Math.floor(n || 2))));
    this.clozeResult.set({});
  }

  toggleClozeReveal(): void {
    this.clozeRevealed.update((r) => !r);
  }

  setClozeTyped(index: number, value: string): void {
    this.clozeTyped.update((t) => ({ ...t, [index]: value }));
  }

  checkCloze(): void {
    const tokens = this.clozeTokens();
    const typed = this.clozeTyped();
    const result: Record<number, boolean> = {};
    tokens.forEach((tok, i) => {
      if (tok.blank) result[i] = clozeMatches(typed[i] ?? '', tok.text);
    });
    this.clozeResult.set(result);
  }

  // --- save ---

  save(): void {
    const chunks = this.chunks();
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.memorizationStudy.save(this.scrollStudyId, { chunks }).subscribe({
      next: (savedStudy) => {
        this.saving.set(false);
        this.saved.set(true);
        this.chunks.set(savedStudy.chunks);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(true);
      },
    });
  }

  /**
   * Grade the active chunk's recall (SM-2) and persist. Updates ONLY the scheduling fields —
   * never the learned-`state` ladder (the two axes stay orthogonal). The schedule is updated
   * optimistically in memory before the save confirms; a save failure keeps it and shows the
   * inline error so a retry re-sends it.
   */
  grade(g: Grade): void {
    const i = this.activeIndex();
    const cs = this.chunks();
    if (i < 0 || i >= cs.length) return;

    const next = applyGrade(readSchedule(cs[i]), g, this.today());
    this.chunks.update((list) =>
      list.map((c, idx) =>
        idx === i
          ? {
              ...c,
              easeFactor: next.easeFactor,
              intervalDays: next.intervalDays,
              repetitions: next.repetitions,
              dueDate: next.dueDate,
              lastReviewed: next.lastReviewed,
            }
          : c,
      ),
    );
    this.save();
  }

  // --- Review mode (flashcard deck) ---

  /** Switch Review/Test/Edit. Entering Review or Test (re)builds the deck from the due queue. */
  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    this.gradeTarget.set(mode === 'learn' ? 'learn' : 'test');
    if (mode === 'review' || mode === 'test') this.buildDeck();
    if (mode === 'test') this.resetTestCard();
    if (mode === 'learn') {
      this.resetTestCard();
      if (this.learnChunk() === null) {
        const idx = nextChunkToLearn(this.chunks(), this.chunkStates());
        if (idx >= 0) this.selectLearnChunk(idx);
      }
    }
  }

  // --- session/study preferences (view-only, persisted in localStorage per scroll study) ---

  private prefKey(suffix: string): string {
    return `memorize:${this.scrollStudyId}:${suffix}`;
  }

  /** Load view-only prefs (new-per-day, again-mode) from localStorage; defaults when absent. */
  private loadPrefs(): void {
    try {
      const npd = localStorage.getItem(this.prefKey('newPerDay'));
      if (npd !== null) {
        const n = parseInt(npd, 10);
        if (Number.isFinite(n)) {
          this.newPerDay.set(Math.max(NEW_PER_DAY_MIN, Math.min(NEW_PER_DAY_MAX, n)));
        }
      }
      const am = localStorage.getItem(this.prefKey('againMode'));
      if (am === 'now' || am === 'later') this.againMode.set(am);
    } catch {
      // localStorage unavailable (private mode / SSR): keep defaults.
    }
  }

  private writePref(suffix: string, value: string): void {
    try {
      localStorage.setItem(this.prefKey(suffix), value);
    } catch {
      // Non-fatal: the pref simply won't persist across reloads.
    }
  }

  /** Set the new-chunks-per-day introduction limit (clamped) and rebuild the deck. */
  setNewPerDay(n: number): void {
    const clamped = Math.max(
      NEW_PER_DAY_MIN,
      Math.min(NEW_PER_DAY_MAX, Math.floor(Number.isFinite(n) ? n : DEFAULT_NEW_PER_DAY)),
    );
    this.newPerDay.set(clamped);
    this.writePref('newPerDay', String(clamped));
    if (this.viewMode() === 'review' || this.viewMode() === 'test') this.buildDeck();
  }

  /** Set what "Again" does this session: 'now' (redo same card) or 'later' (requeue soon). */
  setAgainMode(mode: 'now' | 'later'): void {
    this.againMode.set(mode);
    this.writePref('againMode', mode);
  }

  /** Build the session deck from the due queue, metering new chunks per day; reset to first card. */
  private buildDeck(): void {
    const rows = this.chunks().map((c, index) => ({ index, schedule: readSchedule(c) }));
    this.deck.set(selectDeck(rows, this.today(), this.newPerDay()));
    this.deckPos.set(0);
    this.flipped.set(false);
    this.scaffold.set('none');
    this.syncActiveToCard();
  }

  /** Keep `activeIndex` pointed at the current card so grade()/activeDueLabel operate on it. */
  private syncActiveToCard(): void {
    const i = this.currentCardIndex();
    if (i >= 0) this.activeIndex.set(i);
  }

  /** Flip the current card front↔back. */
  flip(): void {
    if (this.deckComplete()) return;
    this.flipped.update((f) => !f);
  }

  /**
   * Grade the current card via the existing SM-2 `grade()` path (schedule only, never state),
   * then handle the deck move. On "Again": in 'now' mode the SAME card stays up (flip back to the
   * front to try again); in 'later' mode it is requeued a few cards back and the deck advances.
   * Any pass grade (hard/good/easy) always advances.
   */
  gradeCard(g: Grade): void {
    if (this.deckComplete() || this.saving()) return;
    const cardIndex = this.currentCardIndex();
    if (cardIndex < 0) return;

    this.syncActiveToCard();
    this.grade(g); // existing path: applyGrade + save (optimistic)

    if (g === 'again') {
      if (this.againMode() === 'now') {
        // Redo now: keep the same card, just reset it to the front to recite again.
        this.flipped.set(false);
        this.scaffold.set('none');
        return;
      }
      // Later: requeue a few cards back (not the very end) so it recurs soon.
      this.requeueCurrent(cardIndex);
    }
    this.advanceDeck();
  }

  /** Requeue the current card a short distance ahead (3 cards, or the end if the deck is shorter). */
  private requeueCurrent(cardIndex: number): void {
    this.deck.update((d) => {
      const next = [...d];
      const insertAt = Math.min(next.length, this.deckPos() + 4); // ~3 cards later
      next.splice(insertAt, 0, cardIndex);
      return next;
    });
  }

  /** Move to the next card: advance position, reset the flip/scaffold, re-aim activeIndex. */
  private advanceDeck(): void {
    this.deckPos.update((p) => p + 1);
    this.flipped.set(false);
    this.scaffold.set('none');
    this.syncActiveToCard();
  }

  /** Toggle the first-letters scaffold on the card front. */
  toggleScaffold(): void {
    this.scaffold.update((s) => (s === 'first' ? 'none' : 'first'));
  }

  /** Dismiss the shortcut legend for the session. */
  dismissLegend(): void {
    this.legendDismissed.set(true);
  }

  /** Keyboard on the card: Space/Enter/→ flips; once flipped, 1-4 grade. */
  onCardKeydown(e: KeyboardEvent): void {
    if (this.deckComplete()) return;
    if (!this.flipped()) {
      if (isFlipKey(e.key)) {
        e.preventDefault();
        this.flip();
      }
      return;
    }
    const g = keyToGrade(e.key);
    if (g) {
      e.preventDefault();
      this.gradeCard(g);
    } else if (isFlipKey(e.key)) {
      // allow flipping back
      e.preventDefault();
      this.flip();
    }
  }

  /** Record the pointer start for swipe classification. */
  onCardPointerDown(e: PointerEvent): void {
    this.swipeStart = { x: e.clientX, y: e.clientY };
  }

  /** On pointer release, classify the swipe: up = flip; once flipped, left = Again, right = Easy. */
  onCardPointerUp(e: PointerEvent): void {
    const start = this.swipeStart;
    this.swipeStart = null;
    if (!start || this.deckComplete()) return;
    const dir = classifySwipe(e.clientX - start.x, e.clientY - start.y, DEFAULT_SWIPE_OPTIONS);
    if (dir === 'none') return; // a tap (not a swipe) is handled by (click)=flip()
    if (dir === 'up') return; // swipe-up no longer flips; tap, Space or Reveal does
    if (this.flipped()) {
      const g = swipeToGrade(dir);
      if (g) this.gradeCard(g);
    }
  }

  /** Global keydown: route card shortcuts in Review mode, ignoring events from form fields. */
  onDocumentKeydown(e: KeyboardEvent): void {
    if (this.viewMode() !== 'review' || this.state() !== 'ready') return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // If focus is already on the card it handles its own keydown; this covers the rest of the page.
    if (target?.getAttribute('data-testid') === 'review-card') return;
    this.onCardKeydown(e);
  }

  // --- Learn mode ---

  /** Underscores the same length as a blanked word (Fill stage). */
  blankOf(word: string): string {
    return '_'.repeat(Math.max(2, word.length));
  }

  /** Choose which chunk to learn; resets the per-verse view state. */
  selectLearnChunk(index: number): void {
    this.learnIndex.set(Number.isInteger(index) && index >= 0 ? index : -1);
    this.learnStage.set('read');
    this.learnRevealed.set(false);
    this.learnFillRevealed.set(false);
    this.resetTestCard();
  }

  setLearnStage(stage: LearnStage): void {
    this.learnStage.set(stage);
    this.learnFillRevealed.set(false);
    if (stage !== 'recite') {
      this.learnRevealed.set(false);
      this.resetTestCard();
    }
  }

  toggleLearnFill(): void {
    this.learnFillRevealed.update((r) => !r);
  }

  revealLearn(): void {
    this.learnRevealed.set(true);
  }

  /** Write new Learn progress onto the chunk and persist via the existing save path. */
  private commitLearn(index: number, learn: MemorizationLearnProgress): void {
    this.chunks.update((cs) => cs.map((c, i) => (i === index ? { ...c, learn } : c)));
    this.save();
  }

  /** "Got it": the newest unlocked verse (cumulative range) is learned. Never unlocks by itself. */
  learnGotIt(): void {
    const i = this.learnIndex();
    if (i < 0 || this.saving()) return;
    this.commitLearn(i, markLearned(this.learnProgress()));
    this.learnRevealed.set(false);
    this.resetTestCard();
  }

  /** "Not yet": back to reading the verse; it stays unlearned. */
  learnNotYet(): void {
    const i = this.learnIndex();
    if (i < 0 || this.saving()) return;
    this.commitLearn(i, unmarkLearned(this.learnProgress()));
    this.setLearnStage('read');
  }

  /** Explicitly unlock the next verse (allowed even if the current one is not marked learned). */
  learnUnlockNext(): void {
    const i = this.learnIndex();
    if (i < 0 || this.saving()) return;
    this.commitLearn(i, unlockNext(this.learnProgress(), this.learnVerses().length));
    this.setLearnStage('read');
  }

  /**
   * Grade the whole chunk once every verse is learned. Runs the existing SM-2 path (one save that
   * carries both the schedule and the Learn progress). "Again" is a miss: the last verse goes back
   * to unlearned and the student recites the chunk again; any pass marks the chunk done.
   */
  learnGrade(g: Grade): void {
    const i = this.learnIndex();
    if (i < 0 || this.saving() || !this.learnReady()) return;
    const progress = this.learnProgress();
    const learn = g === 'again' ? unmarkLearned(progress) : markDone(progress);
    this.chunks.update((cs) => cs.map((c, idx) => (idx === i ? { ...c, learn } : c)));
    this.activeIndex.set(i);
    this.grade(g); // applyGrade + a single save
    this.learnStage.set('recite');
    this.learnRevealed.set(false);
    this.resetTestCard();
  }

  learnNextChunk(): void {
    const idx = this.learnNextIndex();
    if (idx >= 0) this.selectLearnChunk(idx);
  }

  /** Start this chunk's Learn run over. The SM-2 schedule is left alone. */
  learnRelearn(): void {
    const i = this.learnIndex();
    if (i < 0 || this.saving()) return;
    this.commitLearn(i, initialLearn());
    this.selectLearnChunk(i);
  }

  // --- Test mode (spoken-recitation auto-grade) ---

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

  /** Reset the test card to its idle (pre-recording) state for the current chunk. */
  private resetTestCard(): void {
    this.testPhase.set('idle');
    this.gradeResult.set(null);
    this.testError.set(false);
  }

  /** Begin recording the recitation. On any failure, degrade to manual grading. */
  async startRecording(): Promise<void> {
    if (!this.recordingSupported()) return;
    if (this.gradeTarget() === 'test' && this.deckComplete()) return;
    this.testError.set(false);
    this.gradeResult.set(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;
      this.recordedChunks = [];
      const recorder = new MediaRecorder(stream);
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };
      recorder.onstop = () => this.onRecordingStopped();
      recorder.start();
      this.testPhase.set('recording');
      // Safety cap: auto-stop a runaway recording.
      this.recordStopTimer = setTimeout(() => this.stopRecording(), MemorizeStore.MAX_RECORD_MS);
    } catch {
      // Permission denied / no device: fall back to manual grading for this card.
      this.teardownStream();
      this.testError.set(true);
      this.testPhase.set('idle');
    }
  }

  /** Stop recording; the recorder's onstop handler runs the grade flow. */
  stopRecording(): void {
    if (this.recordStopTimer) {
      clearTimeout(this.recordStopTimer);
      this.recordStopTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  /** Assemble the clip and send it for grading. */
  private onRecordingStopped(): void {
    this.teardownStream();
    const type = this.mediaRecorder?.mimeType || 'audio/webm';
    const clip = new Blob(this.recordedChunks, { type });
    this.recordedChunks = [];
    this.mediaRecorder = null;
    if (clip.size === 0) {
      this.testError.set(true);
      this.testPhase.set('idle');
      return;
    }
    this.gradeClip(clip);
  }

  /** Send the recorded clip to the grade service, then apply per drive/desk mode. */
  private gradeClip(clip: Blob): void {
    this.testPhase.set('grading');
    const learning = this.gradeTarget() === 'learn';
    const chunkText = this.gradeReferenceText();
    const reference = learning ? (this.learnChunk()?.verseRef ?? '') : this.cardRef();
    this.recitationGrade.gradeRecitation(clip, chunkText, reference).subscribe({
      next: (result) => {
        this.gradeResult.set(result);
        this.testPhase.set('graded');
        if (learning) {
          // Learn: show the result only. It never writes the SM-2 schedule.
          this.learnRevealed.set(true);
          return;
        }
        // Drive mode: auto-commit the computed grade and advance — no screen touch.
        if (this.testDriveMode() === 'drive') {
          this.commitTestGrade(result.grade);
        }
      },
      error: () => {
        // Service failure: let the student self-grade with the manual buttons.
        this.testError.set(true);
        this.gradeResult.set(null);
        this.testPhase.set('graded');
        if (learning) this.learnRevealed.set(true);
      },
    });
  }

  /** Commit a grade (confirmed, overridden, or auto in drive mode) and handle the deck move. */
  commitTestGrade(g: RecitationGradeValue): void {
    if (this.deckComplete() || this.saving()) return;
    const cardIndex = this.currentCardIndex();
    if (cardIndex < 0) return;
    this.syncActiveToCard();
    this.grade(g); // existing SM-2 path (schedule only)

    if (g === 'again' && this.againMode() === 'now') {
      // Redo now: stay on the same verse, reset the test card to record again.
      this.resetTestCard();
      return;
    }
    if (g === 'again') {
      this.requeueCurrent(cardIndex);
    }
    this.advanceDeck();
    this.resetTestCard();
  }

  /** Stop any live mic stream and release the device. */
  private teardownStream(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
  }

  /** Set drive vs desk grading mode. */
  setTestDriveMode(mode: 'desk' | 'drive'): void {
    this.testDriveMode.set(mode);
  }
}
