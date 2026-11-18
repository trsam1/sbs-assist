import { ChangeDetectionStrategy, Component, HostListener, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToolShellComponent } from '../tool-shell/tool-shell.component';
import { ScrollToolContext } from '../tool-shell/scroll-tool-context';
import { MemorizeStore } from './memorize-store';
import { MemorizeLearn } from './memorize-learn.service';
import { MemorizeTest } from './memorize-test.service';
import { MemorizeCoach } from './memorize-coach';
import { MemorizeCoachBarComponent } from './memorize-coach-bar.component';
import { MemorizeLearnComponent } from './memorize-learn.component';
import { MemorizeReviewComponent } from './memorize-review.component';
import { MemorizeTestComponent } from './memorize-test.component';
import { MemorizeEditComponent } from './memorize-edit.component';

@Component({
  selector: 'app-memorize-view',
  imports: [
    FormsModule,
    ToolShellComponent,
    MemorizeLearnComponent,
    MemorizeReviewComponent,
    MemorizeTestComponent,
    MemorizeEditComponent,
    MemorizeCoachBarComponent,
  ],
  providers: [ScrollToolContext, MemorizeStore, MemorizeLearn, MemorizeTest, MemorizeCoach],
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
            <app-memorize-learn />
          }

          @if (store.viewMode() === 'review') {
            <app-memorize-review />
          } @else if (store.viewMode() === 'test') {
            <app-memorize-test />
          } @else {
            <app-memorize-edit />
          }
        </app-tool-shell>
        <app-memorize-coach-bar />
      </div>
    </section>
  `,
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
