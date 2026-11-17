import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MemorizeStore } from './memorize-store';
import { MEMORIZE_STYLES } from './memorize-styles';

/** The Review pane of the Memorize page. Reads and drives the page's `MemorizeStore`. */
@Component({
  selector: 'app-memorize-review',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ===== Review mode: flashcard deck driven by the due queue ===== -->
    <div class="review-deck" data-testid="memorize-review">
      @if (store.chunks().length === 0) {
        <div class="box has-text-centered" data-testid="review-no-chunks">
          <p class="mb-3">
            No chunks to review yet. Switch to <strong>Edit</strong> to seed this book into chunks,
            then come back to review them.
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
            Nothing due right now — well memorized. Come back when the next review falls due.
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
  `,
  styles: [MEMORIZE_STYLES],
})
export class MemorizeReviewComponent {
  readonly store = inject(MemorizeStore);
}
