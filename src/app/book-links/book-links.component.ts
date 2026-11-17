import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BookStudy } from '../models';

/**
 * The new selection after the student checks or unchecks a book. Ids that match no loaded book (a book
 * that was deleted) are dropped on the first change, so stale ids clean themselves up.
 */
export function toggleBook(
  selected: readonly string[],
  books: readonly Pick<BookStudy, 'id'>[],
  id: string,
  checked: boolean,
): string[] {
  const known = new Set(books.map((b) => b.id));
  const kept = selected.filter((s) => known.has(s) && s !== id);
  return checked ? [...kept, id] : kept;
}

/** The ids in `selected` that match a loaded book, in book order. */
export function visibleSelection(
  selected: readonly string[],
  books: readonly Pick<BookStudy, 'id'>[],
): string[] {
  const chosen = new Set(selected);
  return books.filter((b) => chosen.has(b.id)).map((b) => b.id);
}

/**
 * A checkbox list of the student's books. A word study can be linked to several, since a key word can
 * matter in more than one book. The parent owns the selection.
 */
@Component({
  selector: 'app-book-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="box" data-testid="book-links">
      <legend class="label is-small px-2">Books this study belongs to</legend>
      @if (books().length === 0) {
        <p class="help" data-testid="book-links-empty">
          No books yet. Create a book study to link this word to it.
        </p>
      } @else {
        <div class="is-flex is-flex-wrap-wrap">
          @for (b of books(); track b.id) {
            <label class="checkbox mr-4 mb-1">
              <input
                type="checkbox"
                [checked]="isChecked(b.id)"
                (change)="onToggle(b.id, $any($event.target).checked)"
                [attr.data-testid]="'book-link-' + b.id"
              />
              {{ b.book }}
              @if (b.title.trim()) {
                <span class="has-text-grey"> — {{ b.title }}</span>
              }
            </label>
          }
        </div>
      }
    </fieldset>
  `,
})
export class BookLinksComponent {
  readonly books = input.required<readonly BookStudy[]>();
  readonly selected = input.required<readonly string[]>();
  readonly selectedChange = output<string[]>();

  private readonly chosen = computed(() => new Set(this.selected()));

  isChecked(id: string): boolean {
    return this.chosen().has(id);
  }

  onToggle(id: string, checked: boolean): void {
    this.selectedChange.emit(toggleBook(this.selected(), this.books(), id, checked));
  }
}
