import { ChangeDetectionStrategy, Component, HostListener, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ToolShellComponent } from '../tool-shell/tool-shell.component';
import { ScrollToolContext } from '../tool-shell/scroll-tool-context';
import { MemorizeStore } from './memorize-store';

@Component({
  selector: 'app-memorize-view',
  imports: [RouterLink, FormsModule, ToolShellComponent],
  providers: [ScrollToolContext, MemorizeStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Memorize the scroll">
      <div class="container">
        <app-tool-shell stepId="memorize" [ctx]="ctx" [scrollId]="store.scrollStudyId">
          <p class="mb-4">
            Memorize the book from your own scroll. Seed chunks either by a verse count (learn N
            verses at a time) or from your Step 8 paragraphs, then drill chunk by chunk — chaining
            each onto the run, revealing progressively, or filling the blanks. Verse references are
            kept as labels. Your progress is saved.
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
              [class.is-link]="store.viewMode() === 'learn'"
              [attr.aria-pressed]="store.viewMode() === 'learn'"
              (click)="store.setViewMode('learn')"
              data-testid="mode-learn"
            >
              Learn
            </button>
            <button
              type="button"
              class="button"
              [class.is-link]="store.viewMode() === 'review'"
              [attr.aria-pressed]="store.viewMode() === 'review'"
              (click)="store.setViewMode('review')"
              data-testid="mode-review"
            >
              Review
            </button>
            <button
              type="button"
              class="button"
              [class.is-link]="store.viewMode() === 'test'"
              [attr.aria-pressed]="store.viewMode() === 'test'"
              (click)="store.setViewMode('test')"
              data-testid="mode-test"
            >
              Test
            </button>
            <button
              type="button"
              class="button"
              [class.is-link]="store.viewMode() === 'edit'"
              [attr.aria-pressed]="store.viewMode() === 'edit'"
              (click)="store.setViewMode('edit')"
              data-testid="mode-edit"
            >
              Edit
            </button>
          </div>

          @if (store.viewMode() === 'review' || store.viewMode() === 'test') {
            <!-- Shared drill settings: how many new chunks/day, and what "Again" does. -->
            <div class="field is-grouped is-grouped-multiline mb-4" data-testid="drill-settings">
              <div class="control">
                <label class="label is-small mb-1" for="new-per-day">New chunks per day</label>
                <input
                  id="new-per-day"
                  class="input is-small"
                  type="number"
                  [min]="store.NEW_PER_DAY_MIN"
                  [max]="store.NEW_PER_DAY_MAX"
                  [ngModel]="store.newPerDay()"
                  (ngModelChange)="store.setNewPerDay(+$event)"
                  data-testid="new-per-day"
                  style="width: 5rem"
                />
                <p class="help is-size-7">
                  {{ store.newChunkCount() }} new chunk(s) waiting — introduced
                  {{ store.newPerDay() }}/day.
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
                    [class.is-link]="store.againMode() === 'now'"
                    [attr.aria-pressed]="store.againMode() === 'now'"
                    (click)="store.setAgainMode('now')"
                    data-testid="again-now"
                  >
                    Redo now
                  </button>
                  <button
                    type="button"
                    class="button"
                    [class.is-link]="store.againMode() === 'later'"
                    [attr.aria-pressed]="store.againMode() === 'later'"
                    (click)="store.setAgainMode('later')"
                    data-testid="again-later"
                  >
                    Later this session
                  </button>
                </div>
              </div>
            </div>
          }

          @if (store.viewMode() === 'learn') {
            <!-- ===== Learn mode: one chunk, verse by verse, at the student's pace ===== -->
            <div data-testid="memorize-learn">
              @if (store.chunks().length === 0) {
                <div class="box has-text-centered" data-testid="learn-no-chunks">
                  <p class="mb-3">
                    No chunks yet. Switch to <strong>Edit</strong> to seed this book into chunks,
                    then come back to learn them.
                  </p>
                  <button
                    type="button"
                    class="button is-link"
                    (click)="store.setViewMode('edit')"
                    data-testid="learn-go-edit"
                  >
                    Go to Edit
                  </button>
                </div>
              } @else {
                <div class="field mb-3">
                  <label class="label is-small" for="learn-chunk">Chunk to learn</label>
                  <div class="select is-fullwidth">
                    <select
                      id="learn-chunk"
                      [ngModel]="store.learnIndex()"
                      (ngModelChange)="store.selectLearnChunk(+$event)"
                      data-testid="learn-chunk-select"
                    >
                      @for (c of store.chunks(); track $index) {
                        <option [ngValue]="$index">
                          {{ $index + 1 }}. {{ c.verseRef || 'Chunk ' + ($index + 1)
                          }}{{ c.learn?.done ? ' (learned)' : '' }}
                        </option>
                      }
                    </select>
                  </div>
                </div>

                @if (store.learnChunk(); as lc) {
                  <p class="is-size-6 mb-3" aria-live="polite" data-testid="learn-progress">
                    Chunk {{ store.learnIndex() + 1 }} of {{ store.chunks().length }}
                    @if (lc.verseRef) {
                      <span class="tag is-light ml-2">{{ lc.verseRef }}</span>
                    }
                    <span class="ml-2 has-text-grey">
                      {{ store.learnProgress().unlocked }} of
                      {{ store.learnVerses().length }} verses unlocked
                    </span>
                  </p>

                  @if (store.learnVerses().length === 0) {
                    <div class="notification is-warning is-light" data-testid="learn-no-verses">
                      This chunk has no text to learn. Fix its range in Edit.
                    </div>
                  } @else {
                    <ol class="mb-4" style="list-style: none; margin: 0; padding: 0">
                      @for (v of store.learnVerses(); track $index) {
                        @if ($index >= store.learnProgress().unlocked) {
                          <li class="box learn-locked py-2" data-testid="learn-verse-locked">
                            <span aria-hidden="true">🔒</span> {{ v.label }}
                            <span class="has-text-grey is-size-7">(locked)</span>
                          </li>
                        } @else if ($index < store.learnProgress().unlocked - 1) {
                          <li class="mb-2" data-testid="learn-verse-earlier">
                            <details class="box py-2">
                              <summary>
                                {{ v.label }}
                                @if ($index < store.learnProgress().learned) {
                                  <span class="has-text-success">✓ learned</span>
                                } @else {
                                  <span class="has-text-grey">· not marked learned</span>
                                }
                              </summary>
                              <p class="learn-text mt-2">{{ v.text }}</p>
                            </details>
                          </li>
                        } @else {
                          <li class="box" data-testid="learn-verse-current">
                            <p class="card-ref mb-2">{{ v.label }}</p>
                            <div
                              class="buttons has-addons mb-3"
                              role="group"
                              aria-label="Learn stage"
                            >
                              <button
                                type="button"
                                class="button"
                                [class.is-link]="store.learnStage() === 'read'"
                                [attr.aria-pressed]="store.learnStage() === 'read'"
                                (click)="store.setLearnStage('read')"
                                data-testid="learn-stage-read"
                              >
                                Read
                              </button>
                              <button
                                type="button"
                                class="button"
                                [class.is-link]="store.learnStage() === 'fill'"
                                [attr.aria-pressed]="store.learnStage() === 'fill'"
                                (click)="store.setLearnStage('fill')"
                                data-testid="learn-stage-fill"
                              >
                                Fill
                              </button>
                              <button
                                type="button"
                                class="button"
                                [class.is-link]="store.learnStage() === 'recite'"
                                [attr.aria-pressed]="store.learnStage() === 'recite'"
                                (click)="store.setLearnStage('recite')"
                                data-testid="learn-stage-recite"
                              >
                                Recite
                              </button>
                            </div>

                            @switch (store.learnStage()) {
                              @case ('read') {
                                <p class="learn-text mb-3" data-testid="learn-read-text">
                                  {{ v.text }}
                                </p>
                                <button
                                  type="button"
                                  class="button is-link"
                                  (click)="store.setLearnStage('fill')"
                                  data-testid="learn-next-stage"
                                >
                                  Next: Fill
                                </button>
                              }
                              @case ('fill') {
                                <div class="field mb-2">
                                  <label class="label is-small" for="learn-fill-n">
                                    Blank every Nth word
                                  </label>
                                  <input
                                    id="learn-fill-n"
                                    class="input is-small"
                                    type="number"
                                    min="2"
                                    max="10"
                                    [ngModel]="store.clozeN()"
                                    (ngModelChange)="store.setClozeN(+$event)"
                                    data-testid="learn-fill-n"
                                    style="width: 5rem"
                                  />
                                </div>
                                <p class="learn-text mb-3" data-testid="learn-fill-text">
                                  @for (t of store.learnFillTokens(); track $index) {
                                    @if (t.blank && !store.learnFillRevealed()) {
                                      <span aria-label="blank">{{ store.blankOf(t.text) }}</span>
                                    } @else if (t.blank) {
                                      <strong>{{ t.text }}</strong>
                                    } @else {
                                      <span>{{ t.text }}</span>
                                    }
                                  }
                                </p>
                                <div class="buttons">
                                  <button
                                    type="button"
                                    class="button"
                                    (click)="store.toggleLearnFill()"
                                    data-testid="learn-fill-check"
                                  >
                                    {{ store.learnFillRevealed() ? 'Hide answers' : 'Check' }}
                                  </button>
                                  <button
                                    type="button"
                                    class="button is-link"
                                    (click)="store.setLearnStage('recite')"
                                    data-testid="learn-next-stage"
                                  >
                                    Next: Recite
                                  </button>
                                </div>
                              }
                              @case ('recite') {
                                @if (!store.learnRevealed()) {
                                  <p class="has-text-grey mb-3" data-testid="learn-recite-prompt">
                                    Recite
                                    @if (store.learnProgress().unlocked > 1) {
                                      verses 1 to {{ store.learnProgress().unlocked }}
                                    } @else {
                                      this verse
                                    }
                                    from memory.
                                  </p>
                                  <div class="buttons">
                                    @if (store.recordingSupported()) {
                                      @if (store.testPhase() === 'recording') {
                                        <button
                                          type="button"
                                          class="button is-danger"
                                          (click)="store.stopRecording()"
                                          data-testid="learn-stop"
                                        >
                                          ■ Done reciting
                                        </button>
                                      } @else if (store.testPhase() === 'grading') {
                                        <span class="has-text-grey" data-testid="learn-grading">
                                          Grading your recitation…
                                        </span>
                                      } @else {
                                        <button
                                          type="button"
                                          class="button is-link is-light"
                                          (click)="store.startRecording()"
                                          data-testid="learn-record"
                                        >
                                          🎙 Check by voice
                                        </button>
                                      }
                                    }
                                    <button
                                      type="button"
                                      class="button is-link"
                                      [disabled]="
                                        store.testPhase() === 'recording' ||
                                        store.testPhase() === 'grading'
                                      "
                                      (click)="store.revealLearn()"
                                      data-testid="learn-reveal"
                                    >
                                      Reveal
                                    </button>
                                  </div>
                                } @else {
                                  @if (store.reciteDiff(); as diff) {
                                    <p class="learn-text mb-2" data-testid="learn-revealed-text">
                                      @for (t of diff.verse; track $index) {
                                        <span
                                          [class.missed-word]="!t.matched"
                                          [attr.data-missed]="t.matched ? null : 'true'"
                                          >{{ t.text }}</span
                                        >{{ ' ' }}
                                      }
                                    </p>
                                    <p
                                      class="is-size-7 has-text-grey mb-2"
                                      data-testid="learn-missed-summary"
                                    >
                                      @if (store.reciteMissedCount() === 0) {
                                        Every word was there.
                                      } @else {
                                        Missed {{ store.reciteMissedCount() }}
                                        {{ store.reciteMissedCount() === 1 ? 'word' : 'words' }}
                                        (underlined).
                                      }
                                    </p>
                                    <p class="is-size-6 mb-3" data-testid="learn-said">
                                      <span class="has-text-grey">You said: </span>
                                      @for (t of diff.said; track $index) {
                                        <span [class.extra-word]="!t.matched">{{ t.text }}</span
                                        >{{ ' ' }}
                                      }
                                    </p>
                                  } @else {
                                    <p class="learn-text mb-3" data-testid="learn-revealed-text">
                                      {{ store.learnRangeText() }}
                                    </p>
                                    @if (store.testError()) {
                                      <p
                                        class="is-size-7 has-text-grey mb-3"
                                        data-testid="learn-voice-error"
                                      >
                                        Voice check wasn't available. Check yourself below.
                                      </p>
                                    }
                                  }
                                  @if (store.gradeResult(); as r) {
                                    <p
                                      class="is-size-7 has-text-grey mb-3"
                                      data-testid="learn-voice-result"
                                    >
                                      Voice check: {{ store.gradeLabel(r.grade) }},
                                      {{ r.accuracyPct }}% match. This doesn't change your review
                                      schedule.
                                    </p>
                                  }
                                  <div class="buttons">
                                    <button
                                      type="button"
                                      class="button is-success"
                                      [disabled]="store.saving()"
                                      (click)="store.learnGotIt()"
                                      data-testid="learn-got-it"
                                    >
                                      Got it
                                    </button>
                                    <button
                                      type="button"
                                      class="button"
                                      [disabled]="store.saving()"
                                      (click)="store.learnNotYet()"
                                      data-testid="learn-not-yet"
                                    >
                                      Not yet
                                    </button>
                                  </div>
                                }
                              }
                            }
                          </li>
                        }
                      }
                    </ol>

                    @if (store.learnProgress().done) {
                      <div class="box has-text-centered" data-testid="learn-done">
                        <p class="is-size-5 mb-2">Chunk learned ✓</p>
                        <div class="buttons is-centered">
                          @if (store.learnNextIndex() >= 0) {
                            <button
                              type="button"
                              class="button is-link"
                              (click)="store.learnNextChunk()"
                              data-testid="learn-next-chunk"
                            >
                              Next chunk
                            </button>
                          }
                          <button
                            type="button"
                            class="button is-light"
                            [disabled]="store.saving()"
                            (click)="store.learnRelearn()"
                            data-testid="learn-relearn"
                          >
                            Relearn this chunk
                          </button>
                        </div>
                      </div>
                    } @else if (store.learnReady()) {
                      <div data-testid="learn-grade">
                        <p class="mb-2">All verses are learned. How did the whole chunk go?</p>
                        <div class="grade-row" role="group" aria-label="Grade the whole chunk">
                          <button
                            type="button"
                            class="button is-danger is-light grade-btn"
                            [disabled]="store.saving()"
                            (click)="store.learnGrade('again')"
                            data-testid="learn-grade-again"
                          >
                            Again
                          </button>
                          <button
                            type="button"
                            class="button grade-btn"
                            [disabled]="store.saving()"
                            (click)="store.learnGrade('hard')"
                            data-testid="learn-grade-hard"
                          >
                            Hard
                          </button>
                          <button
                            type="button"
                            class="button grade-btn"
                            [disabled]="store.saving()"
                            (click)="store.learnGrade('good')"
                            data-testid="learn-grade-good"
                          >
                            Good
                          </button>
                          <button
                            type="button"
                            class="button grade-btn"
                            [disabled]="store.saving()"
                            (click)="store.learnGrade('easy')"
                            data-testid="learn-grade-easy"
                          >
                            Easy
                          </button>
                        </div>
                      </div>
                    } @else if (store.learnProgress().unlocked < store.learnVerses().length) {
                      <div>
                        <button
                          type="button"
                          class="button is-link is-fullwidth"
                          [disabled]="store.saving()"
                          (click)="store.learnUnlockNext()"
                          data-testid="learn-unlock-next"
                        >
                          Unlock next verse
                        </button>
                        @if (store.learnProgress().learned < store.learnProgress().unlocked) {
                          <p class="help" data-testid="learn-unlock-hint">
                            The current verse isn't marked learned yet. You can still move on.
                          </p>
                        }
                      </div>
                    }
                  }
                } @else {
                  <div class="box has-text-centered" data-testid="learn-all-done">
                    <p class="is-size-5 mb-2">Every chunk is learned ✓</p>
                    <p class="has-text-grey">
                      Pick a chunk above to relearn it, or use Review for what's due.
                    </p>
                  </div>
                }
              }
            </div>
          }

          @if (store.viewMode() === 'review') {
            <!-- ===== Review mode: flashcard deck driven by the due queue ===== -->
            <div class="review-deck" data-testid="memorize-review">
              @if (store.chunks().length === 0) {
                <div class="box has-text-centered" data-testid="review-no-chunks">
                  <p class="mb-3">
                    No chunks to review yet. Switch to <strong>Edit</strong> to seed this book into
                    chunks, then come back to review them.
                  </p>
                  <button
                    type="button"
                    class="button is-link"
                    (click)="store.setViewMode('edit')"
                    data-testid="review-go-edit"
                  >
                    Go to Edit
                  </button>
                </div>
              } @else if (store.deckComplete()) {
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
                  Card {{ store.deckProgress().pos + 1 }} of {{ store.deckProgress().total }} due
                  @if (store.cardRef()) {
                    <span class="tag is-light ml-2">{{ store.cardRef() }}</span>
                  }
                </p>

                <!-- The review card: plain flowing layout (no fixed height, no 3-D flip), so a
                       multi-verse chunk wraps and scrolls. Tap / Space reveals. -->
                <div
                  class="review-card box"
                  role="button"
                  tabindex="0"
                  [attr.aria-label]="
                    store.flipped()
                      ? 'Card revealed. Grade your recall, or tap to hide.'
                      : 'Hidden card. Tap or press space to reveal.'
                  "
                  (click)="store.flip()"
                  (keydown)="store.onCardKeydown($event)"
                  (pointerdown)="store.onCardPointerDown($event)"
                  (pointerup)="store.onCardPointerUp($event)"
                  data-testid="review-card"
                >
                  @if (!store.flipped()) {
                    <div class="has-text-centered" data-testid="review-card-front">
                      <p class="card-ref">
                        {{ store.cardRef() || 'Chunk ' + store.cardChunkNumber() }}
                      </p>
                      <p class="card-prompt has-text-grey">Recite from memory, then reveal.</p>
                      @if (store.scaffold() === 'first') {
                        <p class="card-scaffold" data-testid="review-scaffold">
                          {{ store.cardScaffoldText() }}
                        </p>
                      }
                    </div>
                  } @else {
                    <div data-testid="review-card-back">
                      <p class="card-ref has-text-centered mb-3">
                        {{ store.cardRef() || 'Chunk ' + store.cardChunkNumber() }}
                      </p>
                      <p class="card-text review-text">{{ store.cardBackText() }}</p>
                    </div>
                  }
                </div>

                <!-- Front controls: scaffold toggle + explicit reveal -->
                @if (!store.flipped()) {
                  <div class="buttons is-centered mt-3">
                    <button
                      type="button"
                      class="button is-small is-light"
                      (click)="store.toggleScaffold(); $event.stopPropagation()"
                      [attr.aria-pressed]="store.scaffold() === 'first'"
                      data-testid="review-scaffold-toggle"
                    >
                      {{ store.scaffold() === 'first' ? 'Hide hint' : 'Show first letters' }}
                    </button>
                    <button
                      type="button"
                      class="button is-small is-link"
                      (click)="store.flip(); $event.stopPropagation()"
                      data-testid="review-reveal"
                    >
                      Reveal
                    </button>
                  </div>
                }

                <!-- Grade controls: large, full-width, bottom-anchored on phones. -->
                @if (store.flipped()) {
                  <p class="is-size-7 has-text-grey has-text-centered mt-3 mb-2">
                    Next review after a pass:
                    <span data-testid="review-next-due">{{ store.activeDueLabel() }}</span>
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
                      [disabled]="store.saving()"
                      (click)="store.gradeCard('again')"
                      data-testid="review-grade-again"
                    >
                      Again
                    </button>
                    <button
                      type="button"
                      class="button grade-btn"
                      [disabled]="store.saving()"
                      (click)="store.gradeCard('hard')"
                      data-testid="review-grade-hard"
                    >
                      Hard
                    </button>
                    <button
                      type="button"
                      class="button grade-btn"
                      [disabled]="store.saving()"
                      (click)="store.gradeCard('good')"
                      data-testid="review-grade-good"
                    >
                      Good
                    </button>
                    <button
                      type="button"
                      class="button is-success is-light grade-btn"
                      [disabled]="store.saving()"
                      (click)="store.gradeCard('easy')"
                      data-testid="review-grade-easy"
                    >
                      Easy
                    </button>
                  </div>
                }

                <!-- Shortcut legend: makes the hands-free controls discoverable. -->
                @if (!store.legendDismissed()) {
                  <div class="notification is-light p-2 mt-3 is-size-7" data-testid="review-legend">
                    <button
                      type="button"
                      class="delete is-small"
                      (click)="store.dismissLegend()"
                      aria-label="Dismiss shortcuts help"
                      data-testid="review-legend-dismiss"
                    ></button>
                    <strong>Hands-free:</strong> tap / Space / swipe&nbsp;up to flip; then
                    <strong>1</strong> Again · <strong>2</strong> Hard · <strong>3</strong> Good ·
                    <strong>4</strong> Easy, or swipe left (Again) / right (Easy).
                  </div>
                }

                @if (store.saveError()) {
                  <p class="has-text-danger has-text-centered mt-2" data-testid="review-save-error">
                    Could not save that grade — it's kept; try again.
                  </p>
                }
              }
            </div>
          } @else if (store.viewMode() === 'test') {
            <!-- ===== Test mode: recite aloud → auto-grade (Transcribe + Bedrock) ===== -->
            <div class="review-deck" data-testid="memorize-test">
              @if (store.chunks().length === 0) {
                <div class="box has-text-centered" data-testid="test-no-chunks">
                  <p class="mb-3">
                    No chunks to test yet. Switch to <strong>Edit</strong> to seed this book into
                    chunks, then come back to test your recall.
                  </p>
                  <button
                    type="button"
                    class="button is-link"
                    (click)="store.setViewMode('edit')"
                    data-testid="test-go-edit"
                  >
                    Go to Edit
                  </button>
                </div>
              } @else if (store.deckComplete()) {
                <div class="box has-text-centered" data-testid="test-complete">
                  <p class="is-size-5 mb-2">All caught up ✓</p>
                  <p class="has-text-grey">Nothing due to test right now — well memorized.</p>
                </div>
              } @else {
                <!-- Deck progress + drive/desk toggle -->
                <div class="level is-mobile mb-2">
                  <div class="level-left">
                    <p class="is-size-6" aria-live="polite" data-testid="test-progress">
                      Card {{ store.deckProgress().pos + 1 }} of
                      {{ store.deckProgress().total }} due
                      @if (store.cardRef()) {
                        <span class="tag is-light ml-2">{{ store.cardRef() }}</span>
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
                        [class.is-link]="store.testDriveMode() === 'desk'"
                        [attr.aria-pressed]="store.testDriveMode() === 'desk'"
                        (click)="store.setTestDriveMode('desk')"
                        data-testid="test-mode-desk"
                      >
                        Desk
                      </button>
                      <button
                        type="button"
                        class="button"
                        [class.is-link]="store.testDriveMode() === 'drive'"
                        [attr.aria-pressed]="store.testDriveMode() === 'drive'"
                        (click)="store.setTestDriveMode('drive')"
                        data-testid="test-mode-drive"
                      >
                        Drive (hands-free)
                      </button>
                    </div>
                  </div>
                </div>

                <div class="box has-text-centered" data-testid="test-card">
                  <p class="card-ref mb-3">
                    {{ store.cardRef() || 'Chunk ' + store.cardChunkNumber() }}
                  </p>

                  @if (!store.recordingSupported()) {
                    <!-- No MediaRecorder / permission: fall back to manual grading. -->
                    <div class="notification is-warning is-light" data-testid="test-no-mic">
                      Voice grading isn't available in this browser. Recite from memory, reveal the
                      text, and grade yourself.
                    </div>
                    <p class="card-text mt-3" data-testid="test-manual-text">
                      {{ store.cardBackText() }}
                    </p>
                  } @else if (store.testPhase() === 'idle') {
                    <p class="has-text-grey mb-4">
                      Recite this passage from memory, then stop — I'll listen and grade you.
                    </p>
                    <button
                      type="button"
                      class="button is-link is-large"
                      (click)="store.startRecording()"
                      data-testid="test-record"
                      style="min-height: 56px"
                    >
                      🎙 Start reciting
                    </button>
                  } @else if (store.testPhase() === 'recording') {
                    <p class="has-text-danger mb-4" aria-live="polite">● Listening…</p>
                    <button
                      type="button"
                      class="button is-danger is-large"
                      (click)="store.stopRecording()"
                      data-testid="test-stop"
                      style="min-height: 56px"
                    >
                      ■ Done reciting
                    </button>
                  } @else if (store.testPhase() === 'grading') {
                    <p class="has-text-grey" aria-live="polite" data-testid="test-grading">
                      Grading your recitation…
                    </p>
                  } @else if (store.testPhase() === 'graded') {
                    <!-- The result: proposal (desk) or committed (drive). -->
                    @if (store.reciteDiff(); as diff) {
                      <p class="card-text recite-words mb-3" data-testid="test-revealed-text">
                        @for (t of diff.verse; track $index) {
                          <span
                            [class.missed-word]="!t.matched"
                            [attr.data-missed]="t.matched ? null : 'true'"
                            >{{ t.text }}</span
                          >{{ ' ' }}
                        }
                      </p>
                      <p class="is-size-7 has-text-grey mb-3" data-testid="test-missed-summary">
                        @if (store.reciteMissedCount() === 0) {
                          Every word was there.
                        } @else {
                          Missed {{ store.reciteMissedCount() }}
                          {{ store.reciteMissedCount() === 1 ? 'word' : 'words' }} (underlined).
                        }
                      </p>
                      <p class="is-size-6 mb-3" data-testid="test-said">
                        <span class="has-text-grey">You said: </span>
                        @for (t of diff.said; track $index) {
                          <span [class.extra-word]="!t.matched">{{ t.text }}</span
                          >{{ ' ' }}
                        }
                      </p>
                    } @else {
                      <p class="card-text mb-3" data-testid="test-revealed-text">
                        {{ store.cardBackText() }}
                      </p>
                      @if (store.gradeResult()) {
                        <p class="is-size-7 has-text-grey mb-3" data-testid="test-no-transcript">
                          No transcript was captured, so missed words can't be highlighted.
                        </p>
                      }
                    }
                    <div aria-live="polite" data-testid="test-result">
                      <p class="is-size-5 mb-1">
                        <span
                          class="tag is-medium"
                          [class.is-danger]="store.gradeResult()?.grade === 'again'"
                          [class.is-warning]="store.gradeResult()?.grade === 'hard'"
                          [class.is-success]="
                            store.gradeResult()?.grade === 'good' ||
                            store.gradeResult()?.grade === 'easy'
                          "
                          data-testid="test-grade-value"
                        >
                          {{ store.gradeLabel(store.gradeResult()?.grade) }}
                        </span>
                        <span class="is-size-6 has-text-grey ml-2" data-testid="test-accuracy">
                          {{ store.gradeResult()?.accuracyPct }}% match
                        </span>
                      </p>
                      <p class="is-size-7 has-text-grey" data-testid="test-reason">
                        {{ store.gradeResult()?.reason }}
                      </p>
                      @if (store.gradeResult()?.degraded) {
                        <p class="is-size-7 has-text-warning" data-testid="test-degraded">
                          (Auto-grade was unavailable — scored by word match. Adjust below.)
                        </p>
                      }
                    </div>

                    @if (store.testDriveMode() === 'desk') {
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
                          [disabled]="store.saving()"
                          (click)="store.commitTestGrade('again')"
                          data-testid="test-grade-again"
                        >
                          Again
                        </button>
                        <button
                          type="button"
                          class="button grade-btn"
                          [disabled]="store.saving()"
                          (click)="store.commitTestGrade('hard')"
                          data-testid="test-grade-hard"
                        >
                          Hard
                        </button>
                        <button
                          type="button"
                          class="button grade-btn"
                          [disabled]="store.saving()"
                          (click)="store.commitTestGrade('good')"
                          data-testid="test-grade-good"
                        >
                          Good
                        </button>
                        <button
                          type="button"
                          class="button is-success is-light grade-btn"
                          [disabled]="store.saving()"
                          (click)="store.commitTestGrade('easy')"
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

                  @if (store.testError()) {
                    <p class="has-text-danger mt-3" data-testid="test-error">
                      Something went wrong grading that — recite again, or grade yourself below.
                    </p>
                  }

                  <!-- Manual grade buttons, always available as the escape hatch. -->
                  @if (
                    !store.recordingSupported() ||
                    store.testPhase() === 'idle' ||
                    store.testError() ||
                    (store.testPhase() === 'graded' && store.testDriveMode() === 'desk')
                  ) {
                    <!-- (rendered above for the graded/desk case; this covers the no-mic path) -->
                  }
                  @if (!store.recordingSupported()) {
                    <div
                      class="grade-row mt-3"
                      role="group"
                      aria-label="Grade your recall"
                      data-testid="test-manual-grade-row"
                    >
                      <button
                        type="button"
                        class="button is-danger is-light grade-btn"
                        [disabled]="store.saving()"
                        (click)="store.commitTestGrade('again')"
                      >
                        Again
                      </button>
                      <button
                        type="button"
                        class="button grade-btn"
                        [disabled]="store.saving()"
                        (click)="store.commitTestGrade('hard')"
                      >
                        Hard
                      </button>
                      <button
                        type="button"
                        class="button grade-btn"
                        [disabled]="store.saving()"
                        (click)="store.commitTestGrade('good')"
                      >
                        Good
                      </button>
                      <button
                        type="button"
                        class="button is-success is-light grade-btn"
                        [disabled]="store.saving()"
                        (click)="store.commitTestGrade('easy')"
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
                  <p class="is-size-6" data-testid="memorize-progress">
                    {{ store.progressLabel() }}
                  </p>
                </div>
              </div>

              <!-- Due-today review queue (SM-2). Derived client-side; never persisted. -->
              @if (store.chunks().length > 0) {
                <div class="box p-3 mb-3" data-testid="memorize-due-queue">
                  <p class="is-size-6 mb-2">
                    <strong data-testid="memorize-due-count">{{ store.dueCount() }}</strong>
                    {{ store.dueCount() === 1 ? 'chunk' : 'chunks' }} due for review today
                  </p>
                  @if (store.dueQueue().length > 0) {
                    <ul>
                      @for (row of store.dueQueue(); track row.index) {
                        <li class="mb-1" data-testid="memorize-due-row">
                          <button
                            class="button is-small is-link is-light"
                            type="button"
                            (click)="store.setActive(row.index)"
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
                      Nothing due today — well memorized. Come back when the next review falls due.
                    </p>
                  }
                </div>
              }

              <!-- Daily reminder preference (opt-in, default off; per-user, not scroll-scoped). -->
              <div class="box p-3 mb-3" data-testid="reminder-pref">
                <label class="checkbox is-size-7">
                  <input
                    type="checkbox"
                    [checked]="store.reminderOptIn()"
                    (change)="store.setReminderOptIn($any($event.target).checked)"
                    data-testid="reminder-optin"
                    aria-label="Email me a daily reminder when chunks are due for review"
                  />
                  Email me a daily reminder when chunks are due for review
                </label>
                @if (store.reminderOptIn()) {
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
                        [ngModel]="store.reminderHour()"
                        (ngModelChange)="store.setReminderHour($event)"
                        data-testid="reminder-hour"
                        aria-label="Preferred reminder hour, 0 to 23"
                        style="width: 6rem"
                      />
                    </div>
                  </div>
                }
                @if (store.reminderError()) {
                  <p class="help is-danger" data-testid="reminder-error">
                    {{ store.reminderError() }}
                  </p>
                }
              </div>

              <!-- Seed methods -->
              <div class="field is-grouped is-align-items-end mb-3" data-testid="seed-controls">
                <div class="control">
                  <label class="label is-small mb-1" for="verses-per-chunk">Verses per chunk</label>
                  <input
                    id="verses-per-chunk"
                    class="input is-small"
                    type="number"
                    [min]="store.VERSES_PER_CHUNK_MIN"
                    [max]="store.VERSES_PER_CHUNK_MAX"
                    [ngModel]="store.versesPerChunk()"
                    (ngModelChange)="store.setVersesPerChunk(+$event)"
                    data-testid="verses-per-chunk"
                    style="width: 6rem"
                  />
                </div>
                <div class="control">
                  <button
                    class="button is-small"
                    type="button"
                    [disabled]="!store.hasVerseMarkers()"
                    (click)="store.seedByVerseCount()"
                    data-testid="seed-by-verses"
                  >
                    {{ store.chunks().length === 0 ? 'Seed by verses' : 'Re-seed by verses' }}
                  </button>
                </div>
                @if (store.outlineParagraphs().length > 0) {
                  <div class="control">
                    <button
                      class="button is-small"
                      type="button"
                      (click)="store.seedFromOutline()"
                      data-testid="seed-from-step8"
                    >
                      {{
                        store.chunks().length === 0
                          ? 'Seed from Step 8 paragraphs'
                          : 'Re-seed from Step 8'
                      }}
                    </button>
                  </div>
                }
              </div>

              @if (!store.hasVerseMarkers() && store.outlineParagraphs().length === 0) {
                <div
                  class="notification is-warning is-light"
                  role="status"
                  data-testid="seed-blocked"
                >
                  This scroll has no verse markers and no Step 8 outline yet, so chunks can't be
                  seeded. Add verse references to your scroll text, or complete Step 8 (Outline),
                  then come back.
                </div>
              } @else if (store.chunks().length === 0) {
                <div role="status" data-testid="memorize-empty">
                  No chunks yet. Seed by a verse count, or from your Step 8 paragraphs, then adjust
                  the boundaries.
                </div>
              }

              @if (store.seedUnmapped().length > 0) {
                <div
                  class="notification is-warning is-light"
                  role="alert"
                  data-testid="seed-unmapped"
                >
                  {{ store.seedUnmapped().length }} Step 8 paragraph(s) referenced a location not
                  found in the scroll text and were skipped. Check those paragraphs' references, or
                  adjust the chunks below by hand.
                </div>
              }

              <!-- Chunk editor -->
              @for (chunk of store.chunks(); track $index) {
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
                        [maxlength]="store.VERSE_REF_MAX"
                        placeholder="e.g. 2:5-8"
                        [ngModel]="chunk.verseRef"
                        (ngModelChange)="store.setVerseRef($index, $event)"
                        data-testid="chunk-verseref"
                      />
                    </div>
                    <div class="control">
                      <span class="label is-small mb-1">Progress</span>
                      <span
                        class="tag is-small"
                        [class.is-light]="store.chunkStates()[$index] === 'new'"
                        [class.is-info]="store.chunkStates()[$index] === 'learning'"
                        [class.is-link]="store.chunkStates()[$index] === 'chained'"
                        [class.is-success]="store.chunkStates()[$index] === 'solid'"
                        data-testid="chunk-state"
                        title="Earned automatically from your review history"
                      >
                        {{ store.stateLabels[store.chunkStates()[$index]] }}
                      </span>
                    </div>
                    <div class="control is-expanded"></div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="$index === 0"
                        (click)="store.moveUp($index)"
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
                        (click)="store.mergeUp($index)"
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
                        (click)="store.removeChunk($index)"
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
                  @if (store.outOfRange($index)) {
                    <p class="help is-warning" role="alert" data-testid="chunk-out-of-range">
                      This chunk's range no longer fits the scroll text — re-seed to fix it.
                    </p>
                  }
                  <p class="is-size-7 has-text-grey" data-testid="chunk-preview">
                    {{ store.preview($index) }}
                  </p>
                </div>
              }
            </div>

            <!-- Drill surface -->
            @if (store.chunks().length > 0) {
              <div class="box" data-testid="memorize-drill">
                <h3 class="title is-5">Drill</h3>
                <div class="buttons has-addons are-small" role="group" aria-label="Drill mode">
                  <button
                    type="button"
                    class="button"
                    [class.is-link]="store.mode() === 'chain'"
                    [attr.aria-pressed]="store.mode() === 'chain'"
                    (click)="store.setMode('chain')"
                    data-testid="drill-mode-chain"
                  >
                    Chain
                  </button>
                  <button
                    type="button"
                    class="button"
                    [class.is-link]="store.mode() === 'reveal'"
                    [attr.aria-pressed]="store.mode() === 'reveal'"
                    (click)="store.setMode('reveal')"
                    data-testid="drill-mode-reveal"
                  >
                    Reveal
                  </button>
                  <button
                    type="button"
                    class="button"
                    [class.is-link]="store.mode() === 'cloze'"
                    [attr.aria-pressed]="store.mode() === 'cloze'"
                    (click)="store.setMode('cloze')"
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
                      [ngModel]="store.activeIndex()"
                      (ngModelChange)="store.setActive(+$event)"
                      data-testid="active-chunk"
                    >
                      @for (chunk of store.chunks(); track $index) {
                        <option [value]="$index">
                          {{ $index + 1 }}{{ chunk.verseRef ? ' — ' + chunk.verseRef : '' }}
                        </option>
                      }
                    </select>
                  </div>
                </div>

                <!-- Review schedule: next-due label + three-button store.grade (SM-2). Separate axis
                     from the learned-state ladder — grading never changes the state value. -->
                <div class="field" data-testid="memorize-grade">
                  <p class="is-size-7 has-text-grey mb-2">
                    Next review:
                    <span data-testid="chunk-next-due">{{ store.activeDueLabel() }}</span>
                  </p>
                  <div
                    class="buttons has-addons are-small"
                    role="group"
                    aria-label="Grade your recall"
                  >
                    <button
                      type="button"
                      class="button is-danger is-light"
                      [disabled]="store.saving()"
                      (click)="store.grade('again')"
                      data-testid="grade-again"
                    >
                      Again
                    </button>
                    <button
                      type="button"
                      class="button"
                      [disabled]="store.saving()"
                      (click)="store.grade('hard')"
                      data-testid="grade-hard"
                    >
                      Hard
                    </button>
                    <button
                      type="button"
                      class="button"
                      [disabled]="store.saving()"
                      (click)="store.grade('good')"
                      data-testid="grade-good"
                    >
                      Good
                    </button>
                    <button
                      type="button"
                      class="button is-success is-light"
                      [disabled]="store.saving()"
                      (click)="store.grade('easy')"
                      data-testid="grade-easy"
                    >
                      Easy
                    </button>
                  </div>
                </div>

                @switch (store.mode()) {
                  @case ('chain') {
                    <p class="help mb-2">
                      Recite this chunk, then recite the whole run chained from the first learned
                      chunk.
                    </p>
                    <div class="content" data-testid="chain-active">{{ store.activeText() }}</div>
                    <h4 class="title is-6">Chained run</h4>
                    <div class="content" data-testid="chain-run">{{ store.chainRun() }}</div>
                  }
                  @case ('reveal') {
                    <div class="buttons are-small">
                      <button
                        class="button"
                        [class.is-link]="store.revealLevel() === 'full'"
                        type="button"
                        (click)="store.setReveal('full')"
                        data-testid="reveal-full"
                      >
                        Full
                      </button>
                      <button
                        class="button"
                        [class.is-link]="store.revealLevel() === 'first'"
                        type="button"
                        (click)="store.setReveal('first')"
                        data-testid="reveal-first"
                      >
                        First letters
                      </button>
                      <button
                        class="button"
                        [class.is-link]="store.revealLevel() === 'blank'"
                        type="button"
                        (click)="store.setReveal('blank')"
                        data-testid="reveal-blank"
                      >
                        Blank
                      </button>
                    </div>
                    <div class="content" data-testid="reveal-text">{{ store.revealText() }}</div>
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
                          [ngModel]="store.clozeN()"
                          (ngModelChange)="store.setClozeN(+$event)"
                          data-testid="cloze-n"
                          style="width: 5rem"
                        />
                      </div>
                      <div class="control"><span class="is-size-7">word(s)</span></div>
                      <div class="control">
                        <button
                          class="button is-small"
                          type="button"
                          (click)="store.toggleClozeReveal()"
                          data-testid="cloze-reveal-toggle"
                        >
                          {{ store.clozeRevealed() ? 'Hide answers' : 'Reveal answers' }}
                        </button>
                      </div>
                    </div>
                    <div class="content" data-testid="cloze-tokens">
                      @for (tok of store.clozeTokens(); track $index) {
                        @if (tok.blank) {
                          <span
                            class="tag is-light"
                            [class.is-success]="store.clozeResult()[$index] === true"
                            [class.is-danger]="store.clozeResult()[$index] === false"
                            data-testid="cloze-slot"
                          >
                            @if (store.clozeRevealed()) {
                              {{ tok.text }}
                            } @else {
                              <input
                                class="input is-small"
                                type="text"
                                [ngModel]="store.clozeTyped()[$index] ?? ''"
                                (ngModelChange)="store.setClozeTyped($index, $event)"
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
                      (click)="store.checkCloze()"
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
                [class.is-loading]="store.saving()"
                [disabled]="store.saving()"
                (click)="store.save()"
                data-testid="memorize-save"
              >
                Save
              </button>
            </div>
            <div aria-live="polite">
              @if (store.saved()) {
                <p class="has-text-success" data-testid="memorize-saved">Saved.</p>
              }
              @if (store.saveError()) {
                <p class="has-text-danger" data-testid="memorize-save-error">
                  Could not save. Your work is still here — try again.
                </p>
              }
            </div>
          }
        </app-tool-shell>
      </div>
    </section>
  `,
  styles: [
    `
      /* Review card: flowing layout, themed via Bulma CSS variables. */
      .review-card {
        cursor: pointer;
        outline: none;
      }
      .review-card:focus-visible {
        outline: 2px solid var(--bulma-link, #485fc7);
        outline-offset: 3px;
      }
      .review-text {
        text-align: left;
      }
      .learn-text {
        font-size: 1.15rem;
        line-height: 1.6;
      }
      .learn-locked {
        opacity: 0.7;
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
      /* Missed-word highlight: color plus underline so it is not color-only. */
      .missed-word {
        color: var(--bulma-danger, #f14668);
        font-weight: 600;
        text-decoration: underline;
        text-decoration-thickness: 2px;
      }
      .recite-words {
        white-space: normal;
      }
      .extra-word {
        font-style: italic;
        text-decoration: line-through;
        opacity: 0.8;
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
    `,
  ],
})
export class MemorizeViewComponent implements OnInit {
  readonly ctx = inject(ScrollToolContext);
  readonly store = inject(MemorizeStore);

  ngOnInit(): void {
    this.store.init();
  }

  /** Global keydown: the store routes card shortcuts in Review mode. */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(e: KeyboardEvent): void {
    this.store.onDocumentKeydown(e);
  }
}
