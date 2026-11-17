import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BookStudy } from '../models';
import { BookBundle, failedParts } from './book-bundle';
import { BookBundleService } from './book-bundle.service';
import { buildEntries, scrollEntries, search, totalMatches } from './book-search';

const DEBOUNCE_MS = 150;

/**
 * "Search this book" on Book home. The first search loads the book's work once; later searches run in
 * memory. Results are grouped by tool and link to the page where each item can be edited.
 */
@Component({
  selector: 'app-book-search',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      class="box"
      role="search"
      aria-label="Search this book"
      (submit)="$event.preventDefault(); commit()"
      data-testid="book-search"
    >
      <div class="field has-addons">
        <div class="control is-expanded">
          <label class="is-sr-only" for="book-search-input">Search this book's work</label>
          <input
            id="book-search-input"
            class="input"
            type="search"
            placeholder="Search notes, word studies, outline, questions, scroll…"
            [value]="raw()"
            (input)="onInput($any($event.target).value)"
            autocomplete="off"
            data-testid="book-search-input"
          />
        </div>
        <div class="control">
          <button class="button is-link" type="submit" data-testid="book-search-submit">
            Search
          </button>
        </div>
      </div>
      <label class="checkbox is-size-7">
        <input
          type="checkbox"
          [checked]="includeScroll()"
          (change)="includeScroll.set($any($event.target).checked)"
          data-testid="book-search-scroll"
        />
        Search scroll text
      </label>

      <div aria-live="polite" class="mt-3" data-testid="book-search-status">
        @if (loading()) {
          <p class="is-size-7">Loading this book's work…</p>
        } @else if (loadError()) {
          <p class="is-size-7 has-text-danger" role="alert" data-testid="book-search-error">
            This book's work could not be loaded. Press Search to try again.
          </p>
        } @else if (query()) {
          @if (total() === 0) {
            <p class="is-size-7">No results for "{{ query() }}".</p>
          } @else {
            <p class="is-size-7">
              {{ total() }} {{ total() === 1 ? 'result' : 'results' }} in {{ groups().length }}
              {{ groups().length === 1 ? 'place' : 'places' }}.
            </p>
          }
          @if (unavailable()) {
            <p class="is-size-7 has-text-warning-dark" data-testid="book-search-partial">
              Some parts could not be loaded: {{ unavailable() }}. Results may be incomplete.
            </p>
          }
        }
      </div>

      @for (g of groups(); track g.id) {
        <details open class="mt-3" [attr.data-testid]="'search-group-' + g.id">
          <summary class="has-text-weight-semibold">
            {{ g.label }} <span class="tag is-light">{{ g.total }}</span>
          </summary>
          <ul class="ml-4">
            @for (h of g.hits; track $index) {
              <li class="mb-1" data-testid="search-hit">
                <span class="is-size-7 has-text-grey">{{ h.field }}: </span>
                @if (h.link) {
                  <a [routerLink]="h.link">
                    <ng-container *ngTemplateOutlet="snip; context: { $implicit: h }" />
                  </a>
                } @else {
                  <ng-container *ngTemplateOutlet="snip; context: { $implicit: h }" />
                }
              </li>
            }
          </ul>
          @if (g.total > g.hits.length) {
            <p class="is-size-7 has-text-grey ml-4" data-testid="search-more">
              and {{ g.total - g.hits.length }} more. Narrow the search to see them.
            </p>
          }
        </details>
      }
    </form>

    <ng-template #snip let-h>
      @if (h.cutStart) {
        <span>…</span>
      }
      @for (s of h.segments; track $index) {
        @if (s.mark) {
          <mark>{{ s.text }}</mark>
        } @else {
          <span>{{ s.text }}</span>
        }
      }
      @if (h.cutEnd) {
        <span>…</span>
      }
    </ng-template>
  `,
})
export class BookSearchComponent implements OnDestroy {
  private readonly bundles = inject(BookBundleService);

  readonly book = input.required<BookStudy>();
  /** The book's scroll study id, or '' when it has none yet. */
  readonly scrollStudyId = input<string>('');

  readonly raw = signal('');
  /** The committed (debounced) query that results are computed from. */
  readonly query = signal('');
  readonly includeScroll = signal(true);
  readonly loading = signal(false);
  readonly loadError = signal(false);
  private readonly bundle = signal<BookBundle | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly baseEntries = computed(() => {
    const b = this.bundle();
    return b ? buildEntries(b) : [];
  });
  private readonly scrollOnly = computed(() => {
    const b = this.bundle();
    return b ? scrollEntries(b) : [];
  });

  readonly groups = computed(() => {
    const entries = this.includeScroll()
      ? [...this.baseEntries(), ...this.scrollOnly()]
      : this.baseEntries();
    return search(entries, this.query());
  });
  readonly total = computed(() => totalMatches(this.groups()));
  readonly unavailable = computed(() => {
    const b = this.bundle();
    return b ? failedParts(b).join(', ') : '';
  });

  onInput(value: string): void {
    this.raw.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), DEBOUNCE_MS);
  }

  /** Apply the typed query now (Enter or the Search button) and load the book's work on first use. */
  commit(): void {
    clearTimeout(this.timer);
    const q = this.raw().trim();
    this.query.set(q);
    if (q && !this.bundle() && !this.loading()) this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.bundles.load(this.book(), this.scrollStudyId()).subscribe({
      next: (b) => {
        this.bundle.set(b);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.loading.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
