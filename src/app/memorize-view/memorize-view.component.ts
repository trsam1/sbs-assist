import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { RecitationGradeService } from '../recitation-grade.service';
import { OutlineStudyService } from '../outline-study.service';
import {
  MemorizationChunk,
  MemorizationChunkState,
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
import {
  classifySwipe,
  swipeToGrade,
  keyToGrade,
  isFlipKey,
  DEFAULT_SWIPE_OPTIONS,
} from './gestures';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';
type ViewMode = 'review' | 'test' | 'edit';
type DrillMode = 'chain' | 'reveal' | 'cloze';
type RevealLevel = 'full' | 'first' | 'blank';

const STATE_LABELS: Record<MemorizationChunkState, string> = {
  new: 'New',
  learning: 'Learning',
  chained: 'Chained',
  solid: 'Solid',
};
const STATE_ORDER: MemorizationChunkState[] = ['new', 'learning', 'chained', 'solid'];

@Component({
  selector: 'app-memorize-view',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Memorize the scroll">
      <div class="container">
        @if (study(); as s) {
          <h2 class="title is-4" data-testid="memorize-book">{{ s.bookName }} — Memorize</h2>
        }

        @switch (state()) {
          @case ('loading') {
            <div class="has-text-centered py-5" aria-live="polite" aria-busy="true">
              <p>Loading…</p>
            </div>
          }
          @case ('ready') {
            <p class="mb-4">
              Memorize the book from your own scroll. Seed chunks either by a verse count (learn N
              verses at a time) or from your Step 8 paragraphs, then drill chunk by chunk — chaining
              each onto the run, revealing progressively, or filling the blanks. Verse references
              are kept as labels. Your progress is saved.
            </p>

            <!-- Review / Edit mode toggle. Review = the mobile-first flashcard deck; Edit = the
                 full worksheet (seed, chunk editor, drill, reminder pref). -->
            <div
              class="buttons has-addons mb-4"
              role="group"
              aria-label="Review or edit mode"
              data-testid="memorize-mode-toggle"
            >
              <button
                type="button"
                class="button"
                [class.is-link]="viewMode() === 'review'"
                [attr.aria-pressed]="viewMode() === 'review'"
                (click)="setViewMode('review')"
                data-testid="mode-review"
              >
                Review
              </button>
              <button
                type="button"
                class="button"
                [class.is-link]="viewMode() === 'test'"
                [attr.aria-pressed]="viewMode() === 'test'"
                (click)="setViewMode('test')"
                data-testid="mode-test"
              >
                Test
              </button>
              <button
                type="button"
                class="button"
                [class.is-link]="viewMode() === 'edit'"
                [attr.aria-pressed]="viewMode() === 'edit'"
                (click)="setViewMode('edit')"
                data-testid="mode-edit"
              >
                Edit
              </button>
            </div>

            @if (viewMode() === 'review' || viewMode() === 'test') {
              <!-- Shared drill settings: how many new chunks/day, and what "Again" does. -->
              <div class="field is-grouped is-grouped-multiline mb-4" data-testid="drill-settings">
                <div class="control">
                  <label class="label is-small mb-1" for="new-per-day">New chunks per day</label>
                  <input
                    id="new-per-day"
                    class="input is-small"
                    type="number"
                    [min]="NEW_PER_DAY_MIN"
                    [max]="NEW_PER_DAY_MAX"
                    [ngModel]="newPerDay()"
                    (ngModelChange)="setNewPerDay(+$event)"
                    data-testid="new-per-day"
                    style="width: 5rem"
                  />
                  <p class="help is-size-7">
                    {{ newChunkCount() }} new chunk(s) waiting — introduced {{ newPerDay() }}/day.
                  </p>
                </div>
                <div class="control">
                  <span class="label is-small mb-1">On “Again”</span>
                  <div
                    class="buttons has-addons are-small mb-0"
                    role="group"
                    aria-label="Again behavior"
                  >
                    <button
                      type="button"
                      class="button"
                      [class.is-link]="againMode() === 'now'"
                      [attr.aria-pressed]="againMode() === 'now'"
                      (click)="setAgainMode('now')"
                      data-testid="again-now"
                    >
                      Redo now
                    </button>
                    <button
                      type="button"
                      class="button"
                      [class.is-link]="againMode() === 'later'"
                      [attr.aria-pressed]="againMode() === 'later'"
                      (click)="setAgainMode('later')"
                      data-testid="again-later"
                    >
                      Later this session
                    </button>
                  </div>
                </div>
              </div>
            }

            @if (viewMode() === 'review') {
              <!-- ===== Review mode: flashcard deck driven by the due queue ===== -->
              <div class="review-deck" data-testid="memorize-review">
                @if (chunks().length === 0) {
                  <div class="box has-text-centered" data-testid="review-no-chunks">
                    <p class="mb-3">
                      No chunks to review yet. Switch to <strong>Edit</strong> to seed this book
                      into chunks, then come back to review them.
                    </p>
                    <button
                      type="button"
                      class="button is-link"
                      (click)="setViewMode('edit')"
                      data-testid="review-go-edit"
                    >
                      Go to Edit
                    </button>
                  </div>
                } @else if (deckComplete()) {
                  <div class="box has-text-centered" data-testid="review-complete">
                    <p class="is-size-5 mb-2">All caught up ✓</p>
                    <p class="has-text-grey">
                      Nothing due right now — well memorized. Come back when the next review falls
                      due.
                    </p>
                  </div>
                } @else {
                  <!-- Deck progress -->
                  <p
                    class="is-size-6 has-text-centered mb-3"
                    aria-live="polite"
                    data-testid="review-progress"
                  >
                    Card {{ deckProgress().pos + 1 }} of {{ deckProgress().total }} due
                    @if (cardRef()) {
                      <span class="tag is-light ml-2">{{ cardRef() }}</span>
                    }
                  </p>

                  <!-- The flashcard: tap / Space / swipe-up to flip. -->
                  <div
                    class="flashcard"
                    [class.is-flipped]="flipped()"
                    role="button"
                    tabindex="0"
                    [attr.aria-label]="
                      flipped()
                        ? 'Card revealed. Grade your recall, or tap to flip back.'
                        : 'Hidden card. Tap, press space, or swipe up to reveal.'
                    "
                    (click)="flip()"
                    (keydown)="onCardKeydown($event)"
                    (pointerdown)="onCardPointerDown($event)"
                    (pointerup)="onCardPointerUp($event)"
                    data-testid="review-card"
                  >
                    <div class="flashcard-inner">
                      <!-- Front: reference label + optional first-letters scaffold -->
                      <div class="flashcard-face flashcard-front" data-testid="review-card-front">
                        <p class="card-ref">{{ cardRef() || 'Chunk ' + cardChunkNumber() }}</p>
                        <p class="card-prompt has-text-grey">Recite from memory, then flip.</p>
                        @if (scaffold() === 'first') {
                          <p class="card-scaffold" data-testid="review-scaffold">
                            {{ cardScaffoldText() }}
                          </p>
                        }
                      </div>
                      <!-- Back: the full chunk text from the student's own scroll -->
                      <div class="flashcard-face flashcard-back" data-testid="review-card-back">
                        <p class="card-text">{{ cardBackText() }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Front controls: scaffold toggle + explicit reveal -->
                  @if (!flipped()) {
                    <div class="buttons is-centered mt-3">
                      <button
                        type="button"
                        class="button is-small is-light"
                        (click)="toggleScaffold(); $event.stopPropagation()"
                        [attr.aria-pressed]="scaffold() === 'first'"
                        data-testid="review-scaffold-toggle"
                      >
                        {{ scaffold() === 'first' ? 'Hide hint' : 'Show first letters' }}
                      </button>
                      <button
                        type="button"
                        class="button is-small is-link"
                        (click)="flip(); $event.stopPropagation()"
                        data-testid="review-reveal"
                      >
                        Reveal
                      </button>
                    </div>
                  }

                  <!-- Grade controls: large, full-width, bottom-anchored on phones. -->
                  @if (flipped()) {
                    <p class="is-size-7 has-text-grey has-text-centered mt-3 mb-2">
                      Next review after a pass:
                      <span data-testid="review-next-due">{{ activeDueLabel() }}</span>
                    </p>
                    <div
                      class="grade-row"
                      role="group"
                      aria-label="Grade your recall"
                      data-testid="review-grade-row"
                    >
                      <button
                        type="button"
                        class="button is-danger is-light grade-btn"
                        [disabled]="saving()"
                        (click)="gradeCard('again')"
                        data-testid="review-grade-again"
                      >
                        Again
                      </button>
                      <button
                        type="button"
                        class="button grade-btn"
                        [disabled]="saving()"
                        (click)="gradeCard('hard')"
                        data-testid="review-grade-hard"
                      >
                        Hard
                      </button>
                      <button
                        type="button"
                        class="button grade-btn"
                        [disabled]="saving()"
                        (click)="gradeCard('good')"
                        data-testid="review-grade-good"
                      >
                        Good
                      </button>
                      <button
                        type="button"
                        class="button is-success is-light grade-btn"
                        [disabled]="saving()"
                        (click)="gradeCard('easy')"
                        data-testid="review-grade-easy"
                      >
                        Easy
                      </button>
                    </div>
                  }

                  <!-- Shortcut legend: makes the hands-free controls discoverable. -->
                  @if (!legendDismissed()) {
                    <div
                      class="notification is-light p-2 mt-3 is-size-7"
                      data-testid="review-legend"
                    >
                      <button
                        type="button"
                        class="delete is-small"
                        (click)="dismissLegend()"
                        aria-label="Dismiss shortcuts help"
                        data-testid="review-legend-dismiss"
                      ></button>
                      <strong>Hands-free:</strong> tap / Space / swipe&nbsp;up to flip; then
                      <strong>1</strong> Again · <strong>2</strong> Hard · <strong>3</strong> Good ·
                      <strong>4</strong> Easy, or swipe left (Again) / right (Easy).
                    </div>
                  }

                  @if (saveError()) {
                    <p
                      class="has-text-danger has-text-centered mt-2"
                      data-testid="review-save-error"
                    >
                      Could not save that grade — it's kept; try again.
                    </p>
                  }
                }
              </div>
            } @else if (viewMode() === 'test') {
              <!-- ===== Test mode: recite aloud → auto-grade (Transcribe + Bedrock) ===== -->
              <div class="review-deck" data-testid="memorize-test">
                @if (chunks().length === 0) {
                  <div class="box has-text-centered" data-testid="test-no-chunks">
                    <p class="mb-3">
                      No chunks to test yet. Switch to <strong>Edit</strong> to seed this book into
                      chunks, then come back to test your recall.
                    </p>
                    <button
                      type="button"
                      class="button is-link"
                      (click)="setViewMode('edit')"
                      data-testid="test-go-edit"
                    >
                      Go to Edit
                    </button>
                  </div>
                } @else if (deckComplete()) {
                  <div class="box has-text-centered" data-testid="test-complete">
                    <p class="is-size-5 mb-2">All caught up ✓</p>
                    <p class="has-text-grey">Nothing due to test right now — well memorized.</p>
                  </div>
                } @else {
                  <!-- Deck progress + drive/desk toggle -->
                  <div class="level is-mobile mb-2">
                    <div class="level-left">
                      <p class="is-size-6" aria-live="polite" data-testid="test-progress">
                        Card {{ deckProgress().pos + 1 }} of {{ deckProgress().total }} due
                        @if (cardRef()) {
                          <span class="tag is-light ml-2">{{ cardRef() }}</span>
                        }
                      </p>
                    </div>
                    <div class="level-right">
                      <div
                        class="buttons has-addons are-small mb-0"
                        role="group"
                        aria-label="Grading mode"
                        data-testid="test-grade-mode"
                      >
                        <button
                          type="button"
                          class="button"
                          [class.is-link]="testDriveMode() === 'desk'"
                          [attr.aria-pressed]="testDriveMode() === 'desk'"
                          (click)="setTestDriveMode('desk')"
                          data-testid="test-mode-desk"
                        >
                          Desk
                        </button>
                        <button
                          type="button"
                          class="button"
                          [class.is-link]="testDriveMode() === 'drive'"
                          [attr.aria-pressed]="testDriveMode() === 'drive'"
                          (click)="setTestDriveMode('drive')"
                          data-testid="test-mode-drive"
                        >
                          Drive (hands-free)
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="box has-text-centered" data-testid="test-card">
                    <p class="card-ref mb-3">{{ cardRef() || 'Chunk ' + cardChunkNumber() }}</p>

                    @if (!recordingSupported()) {
                      <!-- No MediaRecorder / permission: fall back to manual grading. -->
                      <div class="notification is-warning is-light" data-testid="test-no-mic">
                        Voice grading isn't available in this browser. Recite from memory, reveal
                        the text, and grade yourself.
                      </div>
                      <p class="card-text mt-3" data-testid="test-manual-text">
                        {{ cardBackText() }}
                      </p>
                    } @else if (testPhase() === 'idle') {
                      <p class="has-text-grey mb-4">
                        Recite this passage from memory, then stop — I'll listen and grade you.
                      </p>
                      <button
                        type="button"
                        class="button is-link is-large"
                        (click)="startRecording()"
                        data-testid="test-record"
                        style="min-height: 56px"
                      >
                        🎙 Start reciting
                      </button>
                    } @else if (testPhase() === 'recording') {
                      <p class="has-text-danger mb-4" aria-live="polite">● Listening…</p>
                      <button
                        type="button"
                        class="button is-danger is-large"
                        (click)="stopRecording()"
                        data-testid="test-stop"
                        style="min-height: 56px"
                      >
                        ■ Done reciting
                      </button>
                    } @else if (testPhase() === 'grading') {
                      <p class="has-text-grey" aria-live="polite" data-testid="test-grading">
                        Grading your recitation…
                      </p>
                    } @else if (testPhase() === 'graded') {
                      <!-- The result: proposal (desk) or committed (drive). -->
                      <p class="card-text mb-3" data-testid="test-revealed-text">
                        {{ cardBackText() }}
                      </p>
                      <div aria-live="polite" data-testid="test-result">
                        <p class="is-size-5 mb-1">
                          <span
                            class="tag is-medium"
                            [class.is-danger]="gradeResult()?.grade === 'again'"
                            [class.is-warning]="gradeResult()?.grade === 'hard'"
                            [class.is-success]="
                              gradeResult()?.grade === 'good' || gradeResult()?.grade === 'easy'
                            "
                            data-testid="test-grade-value"
                          >
                            {{ gradeLabel(gradeResult()?.grade) }}
                          </span>
                          <span class="is-size-6 has-text-grey ml-2" data-testid="test-accuracy">
                            {{ gradeResult()?.accuracyPct }}% match
                          </span>
                        </p>
                        <p class="is-size-7 has-text-grey" data-testid="test-reason">
                          {{ gradeResult()?.reason }}
                        </p>
                        @if (gradeResult()?.degraded) {
                          <p class="is-size-7 has-text-warning" data-testid="test-degraded">
                            (Auto-grade was unavailable — scored by word match. Adjust below.)
                          </p>
                        }
                      </div>

                      @if (testDriveMode() === 'desk') {
                        <!-- Desk: propose; the student confirms or overrides before it commits. -->
                        <p class="is-size-7 has-text-grey mt-3 mb-2">
                          Confirm the grade, or override:
                        </p>
                        <div
                          class="grade-row"
                          role="group"
                          aria-label="Confirm or override the grade"
                          data-testid="test-grade-row"
                        >
                          <button
                            type="button"
                            class="button is-danger is-light grade-btn"
                            [disabled]="saving()"
                            (click)="commitTestGrade('again')"
                            data-testid="test-grade-again"
                          >
                            Again
                          </button>
                          <button
                            type="button"
                            class="button grade-btn"
                            [disabled]="saving()"
                            (click)="commitTestGrade('hard')"
                            data-testid="test-grade-hard"
                          >
                            Hard
                          </button>
                          <button
                            type="button"
                            class="button grade-btn"
                            [disabled]="saving()"
                            (click)="commitTestGrade('good')"
                            data-testid="test-grade-good"
                          >
                            Good
                          </button>
                          <button
                            type="button"
                            class="button is-success is-light grade-btn"
                            [disabled]="saving()"
                            (click)="commitTestGrade('easy')"
                            data-testid="test-grade-easy"
                          >
                            Easy
                          </button>
                        </div>
                      } @else {
                        <p
                          class="is-size-7 has-text-grey mt-3"
                          aria-live="polite"
                          data-testid="test-drive-advancing"
                        >
                          Recorded — next verse coming up…
                        </p>
                      }
                    }

                    @if (testError()) {
                      <p class="has-text-danger mt-3" data-testid="test-error">
                        Something went wrong grading that — recite again, or grade yourself below.
                      </p>
                    }

                    <!-- Manual grade buttons, always available as the escape hatch. -->
                    @if (
                      !recordingSupported() ||
                      testPhase() === 'idle' ||
                      testError() ||
                      (testPhase() === 'graded' && testDriveMode() === 'desk')
                    ) {
                      <!-- (rendered above for the graded/desk case; this covers the no-mic path) -->
                    }
                    @if (!recordingSupported()) {
                      <div
                        class="grade-row mt-3"
                        role="group"
                        aria-label="Grade your recall"
                        data-testid="test-manual-grade-row"
                      >
                        <button
                          type="button"
                          class="button is-danger is-light grade-btn"
                          [disabled]="saving()"
                          (click)="commitTestGrade('again')"
                        >
                          Again
                        </button>
                        <button
                          type="button"
                          class="button grade-btn"
                          [disabled]="saving()"
                          (click)="commitTestGrade('hard')"
                        >
                          Hard
                        </button>
                        <button
                          type="button"
                          class="button grade-btn"
                          [disabled]="saving()"
                          (click)="commitTestGrade('good')"
                        >
                          Good
                        </button>
                        <button
                          type="button"
                          class="button is-success is-light grade-btn"
                          [disabled]="saving()"
                          (click)="commitTestGrade('easy')"
                        >
                          Easy
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>
            } @else {
              <!-- ===== Edit mode: the full worksheet (unchanged) ===== -->

              <!-- Progress summary + chunking controls -->
              <div class="box">
                <div class="level is-mobile mb-3">
                  <div class="level-left">
                    <p class="is-size-6" data-testid="memorize-progress">{{ progressLabel() }}</p>
                  </div>
                </div>

                <!-- Due-today review queue (SM-2). Derived client-side; never persisted. -->
                @if (chunks().length > 0) {
                  <div class="box p-3 mb-3" data-testid="memorize-due-queue">
                    <p class="is-size-6 mb-2">
                      <strong data-testid="memorize-due-count">{{ dueCount() }}</strong>
                      {{ dueCount() === 1 ? 'chunk' : 'chunks' }} due for review today
                    </p>
                    @if (dueQueue().length > 0) {
                      <ul>
                        @for (row of dueQueue(); track row.index) {
                          <li class="mb-1" data-testid="memorize-due-row">
                            <button
                              class="button is-small is-link is-light"
                              type="button"
                              (click)="setActive(row.index)"
                              [attr.aria-label]="
                                'Review chunk ' +
                                (row.index + 1) +
                                (row.verseRef ? ' (' + row.verseRef + ')' : '')
                              "
                            >
                              {{ row.index + 1 }}{{ row.verseRef ? ' — ' + row.verseRef : '' }}
                            </button>
                            <span class="is-size-7 has-text-grey ml-2">{{ row.dueLabel }}</span>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="is-size-7 has-text-grey" data-testid="memorize-due-empty">
                        Nothing due today — well memorized. Come back when the next review falls
                        due.
                      </p>
                    }
                  </div>
                }

                <!-- Daily reminder preference (opt-in, default off; per-user, not scroll-scoped). -->
                <div class="box p-3 mb-3" data-testid="reminder-pref">
                  <label class="checkbox is-size-7">
                    <input
                      type="checkbox"
                      [checked]="reminderOptIn()"
                      (change)="setReminderOptIn($any($event.target).checked)"
                      data-testid="reminder-optin"
                      aria-label="Email me a daily reminder when chunks are due for review"
                    />
                    Email me a daily reminder when chunks are due for review
                  </label>
                  @if (reminderOptIn()) {
                    <div class="field is-grouped is-align-items-end mt-2">
                      <div class="control">
                        <label class="label is-small mb-1" for="reminder-hour"
                          >Preferred hour (0–23)</label
                        >
                        <input
                          id="reminder-hour"
                          class="input is-small"
                          type="number"
                          min="0"
                          max="23"
                          [ngModel]="reminderHour()"
                          (ngModelChange)="setReminderHour($event)"
                          data-testid="reminder-hour"
                          aria-label="Preferred reminder hour, 0 to 23"
                          style="width: 6rem"
                        />
                      </div>
                    </div>
                  }
                  @if (reminderError()) {
                    <p class="help is-danger" data-testid="reminder-error">{{ reminderError() }}</p>
                  }
                </div>

                <!-- Seed methods -->
                <div class="field is-grouped is-align-items-end mb-3" data-testid="seed-controls">
                  <div class="control">
                    <label class="label is-small mb-1" for="verses-per-chunk"
                      >Verses per chunk</label
                    >
                    <input
                      id="verses-per-chunk"
                      class="input is-small"
                      type="number"
                      [min]="VERSES_PER_CHUNK_MIN"
                      [max]="VERSES_PER_CHUNK_MAX"
                      [ngModel]="versesPerChunk()"
                      (ngModelChange)="setVersesPerChunk(+$event)"
                      data-testid="verses-per-chunk"
                      style="width: 6rem"
                    />
                  </div>
                  <div class="control">
                    <button
                      class="button is-small"
                      type="button"
                      [disabled]="!hasVerseMarkers()"
                      (click)="seedByVerseCount()"
                      data-testid="seed-by-verses"
                    >
                      {{ chunks().length === 0 ? 'Seed by verses' : 'Re-seed by verses' }}
                    </button>
                  </div>
                  @if (outlineParagraphs().length > 0) {
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        (click)="seedFromOutline()"
                        data-testid="seed-from-step8"
                      >
                        {{
                          chunks().length === 0
                            ? 'Seed from Step 8 paragraphs'
                            : 'Re-seed from Step 8'
                        }}
                      </button>
                    </div>
                  }
                </div>

                @if (!hasVerseMarkers() && outlineParagraphs().length === 0) {
                  <div
                    class="notification is-warning is-light"
                    role="status"
                    data-testid="seed-blocked"
                  >
                    This scroll has no verse markers and no Step 8 outline yet, so chunks can't be
                    seeded. Add verse references to your scroll text, or complete Step 8 (Outline),
                    then come back.
                  </div>
                } @else if (chunks().length === 0) {
                  <div role="status" data-testid="memorize-empty">
                    No chunks yet. Seed by a verse count, or from your Step 8 paragraphs, then
                    adjust the boundaries.
                  </div>
                }

                @if (seedUnmapped().length > 0) {
                  <div
                    class="notification is-warning is-light"
                    role="alert"
                    data-testid="seed-unmapped"
                  >
                    {{ seedUnmapped().length }} Step 8 paragraph(s) referenced a location not found
                    in the scroll text and were skipped. Check those paragraphs' references, or
                    adjust the chunks below by hand.
                  </div>
                }

                <!-- Chunk editor -->
                @for (chunk of chunks(); track $index) {
                  <div class="box p-3 mb-2" data-testid="memorize-chunk-row">
                    <div class="field is-grouped is-align-items-end mb-2">
                      <div class="control">
                        <label class="label is-small mb-1" [attr.for]="'verseref-' + $index"
                          >Reference (label only)</label
                        >
                        <input
                          [id]="'verseref-' + $index"
                          class="input is-small"
                          type="text"
                          [maxlength]="VERSE_REF_MAX"
                          placeholder="e.g. 2:5-8"
                          [ngModel]="chunk.verseRef"
                          (ngModelChange)="setVerseRef($index, $event)"
                          data-testid="chunk-verseref"
                        />
                      </div>
                      <div class="control">
                        <span class="label is-small mb-1">Progress</span>
                        <span
                          class="tag is-small"
                          [class.is-light]="chunkStates()[$index] === 'new'"
                          [class.is-info]="chunkStates()[$index] === 'learning'"
                          [class.is-link]="chunkStates()[$index] === 'chained'"
                          [class.is-success]="chunkStates()[$index] === 'solid'"
                          data-testid="chunk-state"
                          title="Earned automatically from your review history"
                        >
                          {{ stateLabels[chunkStates()[$index]] }}
                        </span>
                      </div>
                      <div class="control is-expanded"></div>
                      <div class="control">
                        <button
                          class="button is-small"
                          type="button"
                          [disabled]="$index === 0"
                          (click)="moveUp($index)"
                          [attr.aria-label]="'Move chunk ' + ($index + 1) + ' up'"
                          data-testid="chunk-reorder"
                        >
                          ↑
                        </button>
                      </div>
                      <div class="control">
                        <button
                          class="button is-small"
                          type="button"
                          [disabled]="$index === 0"
                          (click)="mergeUp($index)"
                          [attr.aria-label]="'Merge chunk ' + ($index + 1) + ' into the one above'"
                          data-testid="chunk-merge"
                        >
                          Merge up
                        </button>
                      </div>
                      <div class="control">
                        <button
                          class="button is-small is-danger is-outlined"
                          type="button"
                          (click)="removeChunk($index)"
                          [attr.aria-label]="'Remove chunk ' + ($index + 1)"
                          data-testid="chunk-remove"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    @if (chunk.verseRef) {
                      <span class="tag is-light is-small mr-2" aria-label="Reference">{{
                        chunk.verseRef
                      }}</span>
                    }
                    @if (outOfRange($index)) {
                      <p class="help is-warning" role="alert" data-testid="chunk-out-of-range">
                        This chunk's range no longer fits the scroll text — re-seed to fix it.
                      </p>
                    }
                    <p class="is-size-7 has-text-grey" data-testid="chunk-preview">
                      {{ preview($index) }}
                    </p>
                  </div>
                }
              </div>

              <!-- Drill surface -->
              @if (chunks().length > 0) {
                <div class="box" data-testid="memorize-drill">
                  <h3 class="title is-5">Drill</h3>
                  <div class="buttons has-addons are-small" role="group" aria-label="Drill mode">
                    <button
                      type="button"
                      class="button"
                      [class.is-link]="mode() === 'chain'"
                      [attr.aria-pressed]="mode() === 'chain'"
                      (click)="setMode('chain')"
                      data-testid="drill-mode-chain"
                    >
                      Chain
                    </button>
                    <button
                      type="button"
                      class="button"
                      [class.is-link]="mode() === 'reveal'"
                      [attr.aria-pressed]="mode() === 'reveal'"
                      (click)="setMode('reveal')"
                      data-testid="drill-mode-reveal"
                    >
                      Reveal
                    </button>
                    <button
                      type="button"
                      class="button"
                      [class.is-link]="mode() === 'cloze'"
                      [attr.aria-pressed]="mode() === 'cloze'"
                      (click)="setMode('cloze')"
                      data-testid="drill-mode-cloze"
                    >
                      Fill blanks
                    </button>
                  </div>

                  <!-- Chunk selector -->
                  <div class="field">
                    <label class="label is-small mb-1" for="active-chunk">Chunk</label>
                    <div class="select is-small">
                      <select
                        id="active-chunk"
                        [ngModel]="activeIndex()"
                        (ngModelChange)="setActive(+$event)"
                        data-testid="active-chunk"
                      >
                        @for (chunk of chunks(); track $index) {
                          <option [value]="$index">
                            {{ $index + 1 }}{{ chunk.verseRef ? ' — ' + chunk.verseRef : '' }}
                          </option>
                        }
                      </select>
                    </div>
                  </div>

                  <!-- Review schedule: next-due label + three-button grade (SM-2). Separate axis
                     from the learned-state ladder — grading never changes the state value. -->
                  <div class="field" data-testid="memorize-grade">
                    <p class="is-size-7 has-text-grey mb-2">
                      Next review: <span data-testid="chunk-next-due">{{ activeDueLabel() }}</span>
                    </p>
                    <div
                      class="buttons has-addons are-small"
                      role="group"
                      aria-label="Grade your recall"
                    >
                      <button
                        type="button"
                        class="button is-danger is-light"
                        [disabled]="saving()"
                        (click)="grade('again')"
                        data-testid="grade-again"
                      >
                        Again
                      </button>
                      <button
                        type="button"
                        class="button"
                        [disabled]="saving()"
                        (click)="grade('hard')"
                        data-testid="grade-hard"
                      >
                        Hard
                      </button>
                      <button
                        type="button"
                        class="button"
                        [disabled]="saving()"
                        (click)="grade('good')"
                        data-testid="grade-good"
                      >
                        Good
                      </button>
                      <button
                        type="button"
                        class="button is-success is-light"
                        [disabled]="saving()"
                        (click)="grade('easy')"
                        data-testid="grade-easy"
                      >
                        Easy
                      </button>
                    </div>
                  </div>

                  @switch (mode()) {
                    @case ('chain') {
                      <p class="help mb-2">
                        Recite this chunk, then recite the whole run chained from the first learned
                        chunk.
                      </p>
                      <div class="content" data-testid="chain-active">{{ activeText() }}</div>
                      <h4 class="title is-6">Chained run</h4>
                      <div class="content" data-testid="chain-run">{{ chainRun() }}</div>
                    }
                    @case ('reveal') {
                      <div class="buttons are-small">
                        <button
                          class="button"
                          [class.is-link]="revealLevel() === 'full'"
                          type="button"
                          (click)="setReveal('full')"
                          data-testid="reveal-full"
                        >
                          Full
                        </button>
                        <button
                          class="button"
                          [class.is-link]="revealLevel() === 'first'"
                          type="button"
                          (click)="setReveal('first')"
                          data-testid="reveal-first"
                        >
                          First letters
                        </button>
                        <button
                          class="button"
                          [class.is-link]="revealLevel() === 'blank'"
                          type="button"
                          (click)="setReveal('blank')"
                          data-testid="reveal-blank"
                        >
                          Blank
                        </button>
                      </div>
                      <div class="content" data-testid="reveal-text">{{ revealText() }}</div>
                    }
                    @case ('cloze') {
                      <div class="field is-grouped is-align-items-center mb-3">
                        <div class="control">
                          <label class="label is-small mb-0 mr-2" for="cloze-n">Hide every</label>
                        </div>
                        <div class="control">
                          <input
                            id="cloze-n"
                            class="input is-small"
                            type="number"
                            min="2"
                            max="10"
                            [ngModel]="clozeN()"
                            (ngModelChange)="setClozeN(+$event)"
                            data-testid="cloze-n"
                            style="width: 5rem"
                          />
                        </div>
                        <div class="control"><span class="is-size-7">word(s)</span></div>
                        <div class="control">
                          <button
                            class="button is-small"
                            type="button"
                            (click)="toggleClozeReveal()"
                            data-testid="cloze-reveal-toggle"
                          >
                            {{ clozeRevealed() ? 'Hide answers' : 'Reveal answers' }}
                          </button>
                        </div>
                      </div>
                      <div class="content" data-testid="cloze-tokens">
                        @for (tok of clozeTokens(); track $index) {
                          @if (tok.blank) {
                            <span
                              class="tag is-light"
                              [class.is-success]="clozeResult()[$index] === true"
                              [class.is-danger]="clozeResult()[$index] === false"
                              data-testid="cloze-slot"
                            >
                              @if (clozeRevealed()) {
                                {{ tok.text }}
                              } @else {
                                <input
                                  class="input is-small"
                                  type="text"
                                  [ngModel]="clozeTyped()[$index] ?? ''"
                                  (ngModelChange)="setClozeTyped($index, $event)"
                                  [attr.aria-label]="'Blank ' + ($index + 1)"
                                  data-testid="cloze-input"
                                  style="width: 6rem"
                                />
                              }
                            </span>
                          } @else {
                            <span>{{ tok.text }}</span>
                          }
                        }
                      </div>
                      <button
                        class="button is-small"
                        type="button"
                        (click)="checkCloze()"
                        data-testid="cloze-check"
                      >
                        Check
                      </button>
                    }
                  }
                </div>
              }

              <!-- Save -->
              <div class="field">
                <button
                  class="button is-primary"
                  type="button"
                  [class.is-loading]="saving()"
                  [disabled]="saving()"
                  (click)="save()"
                  data-testid="memorize-save"
                >
                  Save
                </button>
              </div>
              <div aria-live="polite">
                @if (saved()) {
                  <p class="has-text-success" data-testid="memorize-saved">Saved.</p>
                }
                @if (saveError()) {
                  <p class="has-text-danger" data-testid="memorize-save-error">
                    Could not save. Your work is still here — try again.
                  </p>
                }
              </div>
            }
          }
          @case ('preparing') {
            <div
              class="notification is-info"
              role="status"
              aria-live="polite"
              data-testid="memorize-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="memorize-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="memorize-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="memorize-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="memorize-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="memorize-retry-button"
              >
                Retry
              </button>
            </div>
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      /* Flashcard flip — GPU-composited transform; themed via Bulma CSS variables. */
      .flashcard {
        perspective: 1200px;
        cursor: pointer;
        outline: none;
      }
      .flashcard:focus-visible {
        outline: 2px solid var(--bulma-link, #485fc7);
        outline-offset: 3px;
        border-radius: 8px;
      }
      .flashcard-inner {
        position: relative;
        width: 100%;
        min-height: 12rem;
        transform-style: preserve-3d;
        transition: transform 0.45s cubic-bezier(0.4, 0.2, 0.2, 1);
      }
      .flashcard.is-flipped .flashcard-inner {
        transform: rotateY(180deg);
      }
      .flashcard-face {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1.5rem 1rem;
        border-radius: 10px;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        background: var(--bulma-scheme-main-bis, #f5f5f5);
        color: var(--bulma-text, #363636);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
      }
      .flashcard-back {
        transform: rotateY(180deg);
      }
      .card-ref {
        font-size: 1.5rem;
        font-weight: 700;
      }
      .card-prompt {
        margin-top: 0.5rem;
      }
      .card-scaffold {
        margin-top: 1rem;
        font-family: var(--bulma-family-monospace, monospace);
        letter-spacing: 0.05em;
        word-break: break-word;
      }
      .card-text {
        font-size: 1.15rem;
        line-height: 1.6;
        white-space: pre-wrap;
        text-align: center;
      }
      /* Grade row: large, full-width, bottom-anchored targets. */
      .grade-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.5rem;
      }
      .grade-row .grade-btn {
        width: 100%;
        min-height: 44px;
        font-size: 1rem;
      }
      @media (max-width: 480px) {
        .flashcard-inner {
          min-height: 16rem;
        }
        .grade-row {
          position: sticky;
          bottom: 0;
          background: var(--bulma-scheme-main, #fff);
          padding: 0.5rem 0;
          z-index: 2;
        }
        .grade-row .grade-btn {
          min-height: 52px;
        }
      }
      /* Respect reduced motion: no 3-D rotation, just a cross-fade between faces. */
      @media (prefers-reduced-motion: reduce) {
        .flashcard-inner {
          transform-style: flat;
          transition: none;
        }
        .flashcard.is-flipped .flashcard-inner {
          transform: none;
        }
        .flashcard-face {
          backface-visibility: visible;
          -webkit-backface-visibility: visible;
          transition: opacity 0.2s linear;
        }
        .flashcard-back {
          transform: none;
          opacity: 0;
        }
        .flashcard:not(.is-flipped) .flashcard-front {
          opacity: 1;
        }
        .flashcard.is-flipped .flashcard-front {
          opacity: 0;
        }
        .flashcard.is-flipped .flashcard-back {
          opacity: 1;
        }
      }
    `,
  ],
})
export class MemorizeViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly memorizationStudy = inject(MemorizationStudyService);
  private readonly recitationGrade = inject(RecitationGradeService);
  private readonly outlineStudy = inject(OutlineStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);

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
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private mediaStream: MediaStream | null = null;
  private recordStopTimer: ReturnType<typeof setTimeout> | null = null;
  /** Max recitation length (ms) before recording auto-stops. */
  private static readonly MAX_RECORD_MS = 60_000;

  protected readonly VERSE_REF_MAX = VERSE_REF_MAX;
  protected readonly VERSES_PER_CHUNK_MIN = VERSES_PER_CHUNK_MIN;
  protected readonly VERSES_PER_CHUNK_MAX = VERSES_PER_CHUNK_MAX;
  protected readonly NEW_PER_DAY_MIN = NEW_PER_DAY_MIN;
  protected readonly NEW_PER_DAY_MAX = NEW_PER_DAY_MAX;
  protected readonly stateLabels = STATE_LABELS;
  protected readonly stateOrder = STATE_ORDER;

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
  private todayValue = new Date();
  protected today(): Date {
    return this.todayValue;
  }
  /** Test seam: pin "today" so the due-queue / grade math is deterministic under test. */
  setToday(d: Date): void {
    this.todayValue = d;
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

  /** First-letters scaffold for the current card's text (front hint). */
  readonly cardScaffoldText = computed(() => firstLetters(this.cardBackText()));

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.loadPrefs();
    this.load();
  }

  load(): void {
    this.state.set('loading');
    this.saved.set(false);
    this.saveError.set(false);
    this.scrollStudy.getScrollStudy(this.scrollStudyId).subscribe({
      next: (s) => {
        this.study.set(s);
        if (s.status === 'ready') {
          this.state.set('ready');
          this.loadSaved();
          this.loadOutline();
          this.loadReminderPref();
        } else if (s.status === 'failed') {
          this.state.set('failed');
        } else {
          this.state.set('preparing');
        }
      },
      error: (err: { status?: number }) => {
        this.state.set(err?.status === 404 ? 'failed' : 'error');
      },
    });
  }

  /** Fetch the saved study (if any). A 404 means "none yet" → empty worksheet with a seed action. */
  private loadSaved(): void {
    this.memorizationStudy.get(this.scrollStudyId).subscribe({
      next: (saved) => {
        this.chunks.set(saved.chunks);
        this.buildDeck();
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

  failedMessage(): string {
    const s = this.study();
    if (s?.status === 'failed') {
      return s.failureReason || 'This scroll could not be prepared.';
    }
    return 'This scroll could not be found.';
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
    if (mode === 'review' || mode === 'test') this.buildDeck();
    if (mode === 'test') this.resetTestCard();
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
    if (dir === 'up') {
      this.flip();
      return;
    }
    if (this.flipped()) {
      const g = swipeToGrade(dir);
      if (g) this.gradeCard(g);
    }
  }

  /** Global keydown: route card shortcuts in Review mode, ignoring events from form fields. */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(e: KeyboardEvent): void {
    if (this.viewMode() !== 'review' || this.state() !== 'ready') return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // If focus is already on the card it handles its own keydown; this covers the rest of the page.
    if (target?.getAttribute('data-testid') === 'review-card') return;
    this.onCardKeydown(e);
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
    if (!this.recordingSupported() || this.deckComplete()) return;
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
      this.recordStopTimer = setTimeout(
        () => this.stopRecording(),
        MemorizeViewComponent.MAX_RECORD_MS,
      );
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
    const chunkText = this.cardBackText();
    const reference = this.cardRef();
    this.recitationGrade.gradeRecitation(clip, chunkText, reference).subscribe({
      next: (result) => {
        this.gradeResult.set(result);
        this.testPhase.set('graded');
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
