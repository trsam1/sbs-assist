import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ToolShellComponent } from '../tool-shell/tool-shell.component';
import { ScrollToolContext } from '../tool-shell/scroll-tool-context';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PronounCount, Segment, parsePronouns, toHighlightSegments } from '../pronoun-parse';

@Component({
  selector: 'app-pronoun-view',
  imports: [RouterLink, ToolShellComponent],
  providers: [ScrollToolContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Pronoun study">
      <div class="container">
        <app-tool-shell stepId="pronouns" [ctx]="ctx" [scrollId]="scrollStudyId">
          @if (study()?.truncated) {
            <div class="notification is-warning" role="status" data-testid="pronoun-truncation">
              This scroll text was truncated, so this pronoun list covers only the stored portion.
            </div>
          }

          <p class="mb-4">
            <a
              [routerLink]="['/scroll', scrollStudyId, 'antecedents']"
              class="button is-link is-light is-small"
              data-testid="pronoun-antecedents-link"
            >
              Assign antecedents (Step 6)
            </a>
          </p>

          @if (pronouns().length === 0) {
            <div class="box" role="status" data-testid="pronoun-empty">
              No pronouns found in this scroll.
            </div>
          } @else {
            <p class="mb-3" data-testid="pronoun-totals">
              {{ pronouns().length }} distinct pronouns · {{ totalOccurrences() }} total occurrences
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
        </app-tool-shell>
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
  private readonly route = inject(ActivatedRoute);

  readonly ctx = inject(ScrollToolContext);
  readonly state = this.ctx.state;
  readonly study = this.ctx.study;
  readonly pronouns = signal<PronounCount[]>([]);
  readonly segments = signal<Segment[]>([]);
  readonly highlight = signal(false);

  scrollStudyId = '';

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.load();
  }

  load(): void {
    this.ctx.load(this.scrollStudyId, {
      onReady: (s) => {
        this.pronouns.set(parsePronouns(s.scrollText));
        this.segments.set(toHighlightSegments(s.scrollText));
      },
    });
  }

  totalOccurrences(): number {
    return this.pronouns().reduce((sum, p) => sum + p.count, 0);
  }

  toggleHighlight(): void {
    this.highlight.update((on) => !on);
  }
}
