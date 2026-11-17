import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { neighbours, stepById, stepLabel, stepLink } from '../steps';
import { ScrollToolContext } from './scroll-tool-context';

/**
 * The frame every scroll-based tool page sits in: breadcrumb, heading, previous/next step links, and the
 * loading / preparing / failed / error panels. The page's own content is projected and shown only when
 * the scroll is ready.
 */
@Component({
  selector: 'app-tool-shell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [attr.aria-label]="label()">
      <nav class="breadcrumb is-small" aria-label="Breadcrumb" data-testid="tool-breadcrumb">
        <ul>
          <li>
            @if (bookLink(); as link) {
              <a [routerLink]="link" data-testid="tool-crumb-book">{{ bookName() || 'Book' }}</a>
            } @else {
              <a routerLink="/scrolls" data-testid="tool-crumb-scrolls">Scrolls</a>
            }
          </li>
          @if (scrollId()) {
            <li>
              <a [routerLink]="['/scroll', scrollId()]" data-testid="tool-crumb-scroll">Scroll</a>
            </li>
          }
          <li class="is-active">
            <span class="px-3" aria-current="page">{{ label() }}</span>
          </li>
        </ul>
      </nav>

      @if (ctx().study(); as s) {
        <h2 class="title is-4" data-testid="tool-heading">{{ s.bookName }} — {{ label() }}</h2>
      } @else {
        <h2 class="title is-4" data-testid="tool-heading">{{ label() }}</h2>
      }

      @switch (ctx().state()) {
        @case ('loading') {
          <div
            class="has-text-centered py-5"
            aria-live="polite"
            aria-busy="true"
            data-testid="tool-loading"
          >
            <p>Loading…</p>
          </div>
        }
        @case ('ready') {
          @if (prev() || next()) {
            <div class="buttons are-small mb-3" data-testid="tool-steps">
              @if (prev(); as p) {
                <a
                  class="button is-light"
                  [routerLink]="linkFor(p.id)"
                  data-testid="tool-prev"
                  [attr.aria-label]="'Previous: ' + labelFor(p.id)"
                  >← {{ labelFor(p.id) }}</a
                >
              }
              @if (next(); as n) {
                <a
                  class="button is-light"
                  [routerLink]="linkFor(n.id)"
                  data-testid="tool-next"
                  [attr.aria-label]="'Next: ' + labelFor(n.id)"
                  >{{ labelFor(n.id) }} →</a
                >
              }
            </div>
          }
          <ng-content />
        }
        @case ('preparing') {
          <div
            class="notification is-info"
            role="status"
            aria-live="polite"
            data-testid="tool-preparing"
          >
            <p>
              The scroll text is still being prepared. Open the scroll page to wait for it to
              finish, then come back.
            </p>
            <a
              [routerLink]="['/scroll', scrollId()]"
              class="button is-info is-outlined is-small mt-2"
              data-testid="tool-preparing-back"
            >
              Back to scroll
            </a>
          </div>
        }
        @case ('failed') {
          <div class="notification is-danger" role="alert" data-testid="tool-failed">
            <p>{{ ctx().failedMessage() }}</p>
            <a
              [routerLink]="bookLink() ?? '/scrolls'"
              class="button is-danger is-outlined is-small mt-2"
              data-testid="tool-failed-back"
            >
              {{ bookLink() ? 'Back to book' : 'Back to scroll list' }}
            </a>
          </div>
        }
        @case ('error') {
          <div class="notification is-danger" role="alert" data-testid="tool-error">
            <p>Could not load this scroll study.</p>
            <button
              type="button"
              class="button is-danger is-outlined is-small mt-2"
              (click)="ctx().retry()"
              data-testid="tool-retry"
            >
              Retry
            </button>
          </div>
        }
      }
    </section>
  `,
})
export class ToolShellComponent {
  /** Catalog id of the page this shell frames (see `steps.ts`). */
  readonly stepId = input.required<string>();
  /** The page's scroll context. */
  readonly ctx = input.required<ScrollToolContext>();
  /** The scroll study id, for links back to the scroll. */
  readonly scrollId = input<string>('');

  readonly label = computed(() => {
    const step = stepById(this.stepId());
    return step ? stepLabel(step) : this.stepId();
  });

  readonly bookName = computed(() => this.ctx().study()?.bookName ?? '');

  /** `/books/:id` when the scroll belongs to a book; null for a legacy scroll. */
  readonly bookLink = computed<string[] | null>(() => {
    const id = this.ctx().study()?.bookStudyId;
    return id ? ['/books', id] : null;
  });

  private readonly around = computed(() => neighbours(this.stepId()));
  readonly prev = computed(() => this.around().prev);
  readonly next = computed(() => this.around().next);

  linkFor(id: string): string[] {
    const step = stepById(id);
    return step ? stepLink(step, this.scrollId()) : ['/scrolls'];
  }

  labelFor(id: string): string {
    const step = stepById(id);
    return step ? stepLabel(step) : id;
  }
}
