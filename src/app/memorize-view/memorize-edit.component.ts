import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MemorizeStore } from './memorize-store';
import { MEMORIZE_STYLES } from './memorize-styles';

/** The Edit pane of the Memorize page. Reads and drives the page's `MemorizeStore`. */
@Component({
  selector: 'app-memorize-edit',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
              <label class="label is-small mb-1" for="reminder-hour">Preferred hour (0–23)</label>
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
                store.chunks().length === 0 ? 'Seed from Step 8 paragraphs' : 'Re-seed from Step 8'
              }}
            </button>
          </div>
        }
      </div>

      @if (!store.hasVerseMarkers() && store.outlineParagraphs().length === 0) {
        <div class="notification is-warning is-light" role="status" data-testid="seed-blocked">
          This scroll has no verse markers and no Step 8 outline yet, so chunks can't be seeded. Add
          verse references to your scroll text, or complete Step 8 (Outline), then come back.
        </div>
      } @else if (store.chunks().length === 0) {
        <div role="status" data-testid="memorize-empty">
          No chunks yet. Seed by a verse count, or from your Step 8 paragraphs, then adjust the
          boundaries.
        </div>
      }

      @if (store.seedUnmapped().length > 0) {
        <div class="notification is-warning is-light" role="alert" data-testid="seed-unmapped">
          {{ store.seedUnmapped().length }} Step 8 paragraph(s) referenced a location not found in
          the scroll text and were skipped. Check those paragraphs' references, or adjust the chunks
          below by hand.
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
          <div class="buttons has-addons are-small" role="group" aria-label="Grade your recall">
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
              Recite this chunk, then recite the whole run chained from the first learned chunk.
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
  `,
  styles: [MEMORIZE_STYLES],
})
export class MemorizeEditComponent {
  readonly store = inject(MemorizeStore);
}
