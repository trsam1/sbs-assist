import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MemorizeStore } from './memorize-store';
import { MEMORIZE_STYLES } from './memorize-styles';

/** The Test pane of the Memorize page. Reads and drives the page's `MemorizeStore`. */
@Component({
  selector: 'app-memorize-test',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ===== Test mode: recite aloud → auto-grade (Transcribe + Bedrock) ===== -->
    <div class="review-deck" data-testid="memorize-test">
      @if (store.chunks().length === 0) {
        <div class="box has-text-centered" data-testid="test-no-chunks">
          <p class="mb-3">
            No chunks to test yet. Switch to <strong>Edit</strong> to seed this book into chunks,
            then come back to test your recall.
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
              Card {{ store.deckProgress().pos + 1 }} of {{ store.deckProgress().total }} due
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
              Voice grading isn't available in this browser. Recite from memory, reveal the text,
              and grade yourself.
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
                    store.gradeResult()?.grade === 'good' || store.gradeResult()?.grade === 'easy'
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
              <p class="is-size-7 has-text-grey mt-3 mb-2">Confirm the grade, or override:</p>
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
  `,
  styles: [MEMORIZE_STYLES],
})
export class MemorizeTestComponent {
  readonly store = inject(MemorizeStore);
}
