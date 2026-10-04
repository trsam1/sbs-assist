import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { PronounCount, Segment, parsePronouns, toHighlightSegments } from '../pronoun-parse';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

@Component({
  selector: 'app-pronoun-view',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Pronoun study">
      <div class="container">
        @if (study(); as s) {
          <h2 class="title is-4" data-testid="pronoun-book">{{ s.bookName }} — Pronouns</h2>
        }

        @switch (state()) {
          @case ('loading') {
            <div class="has-text-centered py-5" aria-live="polite" aria-busy="true">
              <p>Loading…</p>
            </div>
          }
          @case ('ready') {
            @if (study()?.truncated) {
              <div class="notification is-warning" role="status" data-testid="pronoun-truncation">
                This scroll text was truncated, so this pronoun list covers only the stored portion.
              </div>
            }

            @if (pronouns().length === 0) {
              <div class="box" role="status" data-testid="pronoun-empty">
                No pronouns found in this scroll.
              </div>
            } @else {
              <p class="mb-3" data-testid="pronoun-totals">
                {{ pronouns().length }} distinct pronouns · {{ totalOccurrences() }} total
                occurrences
              </p>
              <table
                class="table is-striped is-fullwidth"
                aria-label="Pronouns found in the scroll, with occurrence counts"
                data-testid="pronoun-list"
              >
                <thead>
                  <tr>
                    <th>Pronoun</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of pronouns(); track p.word) {
                    <tr data-testid="pronoun-row">
                      <td data-testid="pronoun-word">{{ p.word }}</td>
                      <td data-testid="pronoun-count">{{ p.count }}</td>
                    </tr>
                  }
                </tbody>
              </table>

              <button
                class="button is-info is-light"
                type="button"
                [attr.aria-pressed]="highlight()"
                (click)="toggleHighlight()"
                data-testid="highlight-toggle"
              >
                {{ highlight() ? 'Hide highlight' : 'Highlight pronouns in scroll' }}
              </button>

              @if (highlight()) {
                <div class="box scroll-text-box mt-4" data-testid="pronoun-highlighted-text">
                  <p class="scroll-text">
                    @for (seg of segments(); track $index) {
                      <span [class.pronoun-mark]="seg.kind === 'pronoun'">{{ seg.value }}</span>
                    }
                  </p>
                </div>
              }
            }
          }
          @case ('preparing') {
            <div
              class="notification is-info"
              role="status"
              aria-live="polite"
              data-testid="pronoun-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="pronoun-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="pronoun-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="pronoun-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="pronoun-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="pronoun-retry-button"
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
      .scroll-text-box {
        max-height: 60vh;
        overflow-y: auto;
      }
      .scroll-text {
        white-space: pre-wrap;
        background: transparent;
        padding: 0;
      }
      .pronoun-mark {
        background: #fff3bf;
        border-radius: 2px;
        padding: 0 1px;
      }
    `,
  ],
})
export class PronounViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);
  readonly pronouns = signal<PronounCount[]>([]);
  readonly segments = signal<Segment[]>([]);
  readonly highlight = signal(false);

  scrollStudyId = '';

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.load();
  }

  /** Load the scroll study and derive view state. `pronoun-view` does not poll. */
  load(): void {
    this.state.set('loading');
    this.scrollStudy.getScrollStudy(this.scrollStudyId).subscribe({
      next: (s) => {
        this.study.set(s);
        if (s.status === 'ready') {
          this.pronouns.set(parsePronouns(s.scrollText));
          this.segments.set(toHighlightSegments(s.scrollText));
          this.state.set('ready');
        } else if (s.status === 'failed') {
          this.state.set('failed');
        } else {
          // uploading | extracting
          this.state.set('preparing');
        }
      },
      error: (err: { status?: number }) => {
        this.state.set(err?.status === 404 ? 'failed' : 'error');
      },
    });
  }

  totalOccurrences(): number {
    return this.pronouns().reduce((sum, p) => sum + p.count, 0);
  }

  failedMessage(): string {
    return this.study()?.failureReason || 'This scroll could not be found.';
  }

  toggleHighlight(): void {
    this.highlight.update((on) => !on);
  }
}
