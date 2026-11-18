import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MemorizeStore } from './memorize-store';
import { MemorizeLearn } from './memorize-learn.service';
import { MemorizeTest } from './memorize-test.service';
import { MemorizeCoachControlsComponent } from './memorize-coach-controls.component';
import { MEMORIZE_STYLES } from './memorize-styles';

/** The Learn pane of the Memorize page. Reads and drives the page's `MemorizeStore`. */
@Component({
  selector: 'app-memorize-learn',
  imports: [FormsModule, MemorizeCoachControlsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ===== Learn mode: one chunk, verse by verse, at the student's pace ===== -->
    <div data-testid="memorize-learn">
      @if (store.chunks().length === 0) {
        <div class="box has-text-centered" data-testid="learn-no-chunks">
          <p class="mb-3">
            No chunks yet. Switch to <strong>Edit</strong> to seed this book into chunks, then come
            back to learn them.
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
        <app-memorize-coach-controls kind="learn" />
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
              {{ store.learnProgress().unlocked }} of {{ store.learnVerses().length }} verses
              unlocked
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
                    <div class="buttons has-addons mb-3" role="group" aria-label="Learn stage">
                      <button
                        type="button"
                        class="button"
                        [class.is-link]="store.learnStage() === 'read'"
                        [attr.aria-pressed]="store.learnStage() === 'read'"
                        (click)="learn.setLearnStage('read')"
                        data-testid="learn-stage-read"
                      >
                        Read
                      </button>
                      <button
                        type="button"
                        class="button"
                        [class.is-link]="store.learnStage() === 'fill'"
                        [attr.aria-pressed]="store.learnStage() === 'fill'"
                        (click)="learn.setLearnStage('fill')"
                        data-testid="learn-stage-fill"
                      >
                        Fill
                      </button>
                      <button
                        type="button"
                        class="button"
                        [class.is-link]="store.learnStage() === 'recite'"
                        [attr.aria-pressed]="store.learnStage() === 'recite'"
                        (click)="learn.setLearnStage('recite')"
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
                          (click)="learn.setLearnStage('fill')"
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
                              <input
                                class="input is-small fill-input"
                                [class.is-success]="learn.learnFillResult()[$index] === true"
                                [class.is-danger]="learn.learnFillResult()[$index] === false"
                                type="text"
                                autocomplete="off"
                                autocapitalize="off"
                                autocorrect="off"
                                spellcheck="false"
                                [value]="learn.learnFillTypedAt($index)"
                                (input)="learn.setLearnFillTyped($index, $any($event.target).value)"
                                (keydown.enter)="learn.checkLearnFill()"
                                [style.width.ch]="t.text.length + 3"
                                [attr.aria-label]="
                                  'Blank ' +
                                  learn.learnFillBlankNumbers()[$index] +
                                  ' of ' +
                                  learn.learnFillScore().total
                                "
                                [attr.aria-invalid]="learn.learnFillResult()[$index] === false"
                                data-testid="learn-fill-input"
                              />
                            } @else if (t.blank) {
                              <strong>{{ t.text }}</strong>
                            } @else {
                              <span>{{ t.text }}</span>
                            }
                          }
                        </p>
                        @if (learn.learnFillScore().checked) {
                          <p class="mb-3" aria-live="polite" data-testid="learn-fill-score">
                            {{ learn.learnFillScore().correct }} of
                            {{ learn.learnFillScore().total }} correct
                            @if (learn.learnFillScore().correct < learn.learnFillScore().total) {
                              <span class="has-text-grey">
                                — fix the red ones, or show the answers.</span
                              >
                            }
                          </p>
                        }
                        <div class="buttons">
                          <button
                            type="button"
                            class="button is-link is-light"
                            [disabled]="store.learnFillRevealed()"
                            (click)="learn.checkLearnFill()"
                            data-testid="learn-fill-check"
                          >
                            Check my answers
                          </button>
                          <button
                            type="button"
                            class="button"
                            (click)="learn.toggleLearnFill()"
                            data-testid="learn-fill-reveal"
                          >
                            {{ store.learnFillRevealed() ? 'Hide answers' : 'Show answers' }}
                          </button>
                          <button
                            type="button"
                            class="button is-link"
                            (click)="learn.setLearnStage('recite')"
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
                            @if (test.recordingSupported()) {
                              @if (store.testPhase() === 'recording') {
                                <button
                                  type="button"
                                  class="button is-danger"
                                  (click)="test.stopRecording()"
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
                                  (click)="test.startRecording()"
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
                                store.testPhase() === 'recording' || store.testPhase() === 'grading'
                              "
                              (click)="learn.revealLearn()"
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
                              Voice check: {{ test.gradeLabel(r.grade) }}, {{ r.accuracyPct }}%
                              match. This doesn't change your review schedule.
                            </p>
                          }
                          <div class="buttons">
                            <button
                              type="button"
                              class="button is-success"
                              [disabled]="store.saving()"
                              (click)="learn.learnGotIt()"
                              data-testid="learn-got-it"
                            >
                              Got it
                            </button>
                            <button
                              type="button"
                              class="button"
                              [disabled]="store.saving()"
                              (click)="learn.learnNotYet()"
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
                      (click)="learn.learnNextChunk()"
                      data-testid="learn-next-chunk"
                    >
                      Next chunk
                    </button>
                  }
                  <button
                    type="button"
                    class="button is-light"
                    [disabled]="store.saving()"
                    (click)="learn.learnRelearn()"
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
                    (click)="learn.learnGrade('again')"
                    data-testid="learn-grade-again"
                  >
                    Again
                  </button>
                  <button
                    type="button"
                    class="button grade-btn"
                    [disabled]="store.saving()"
                    (click)="learn.learnGrade('hard')"
                    data-testid="learn-grade-hard"
                  >
                    Hard
                  </button>
                  <button
                    type="button"
                    class="button grade-btn"
                    [disabled]="store.saving()"
                    (click)="learn.learnGrade('good')"
                    data-testid="learn-grade-good"
                  >
                    Good
                  </button>
                  <button
                    type="button"
                    class="button grade-btn"
                    [disabled]="store.saving()"
                    (click)="learn.learnGrade('easy')"
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
                  (click)="learn.learnUnlockNext()"
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
  `,
  styles: [MEMORIZE_STYLES],
})
export class MemorizeLearnComponent {
  readonly store = inject(MemorizeStore);
  readonly learn = inject(MemorizeLearn);
  readonly test = inject(MemorizeTest);
}
