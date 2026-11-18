import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { BookStudyService } from '../book-study.service';
import { StudyCrudService } from '../study-crud.service';
import { BookStudy, StudyWorksheet } from '../models';
import { BookFilter, bookNames, matchesBookFilter } from '../study-books';
import {
  DEFAULT_SORT,
  LANGUAGE_LABELS,
  LanguageFilter,
  SortKey,
  SortState,
  groupByWord,
  languageOf,
  matchesLanguage,
  nextSort,
  plainRows,
  sortStudies,
} from './study-list-sort';

export type ListState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-study-list',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Saved word studies">
      <div class="container">
        <div class="is-flex is-justify-content-space-between is-align-items-center mb-4">
          <h2 class="title is-4 mb-0">My Word Studies</h2>
          <a class="button is-primary is-small" routerLink="/study/new" data-testid="new-word-study"
            >New Word Study</a
          >
        </div>

        @if (state() === 'loading') {
          <div
            class="has-text-centered py-5"
            aria-live="polite"
            aria-busy="true"
            data-testid="loading"
          >
            <p>Loading your studies…</p>
          </div>
        }

        @if (state() === 'error') {
          <div class="notification is-danger" role="alert" data-testid="error">
            <p>Failed to load studies. Please try again.</p>
            <button
              class="button is-danger is-outlined is-small mt-2"
              (click)="loadStudies()"
              data-testid="retry-button"
            >
              Retry
            </button>
          </div>
        }

        @if (state() === 'loaded') {
          @if (studies().length === 0) {
            <div class="box has-text-centered has-text-grey" data-testid="empty-state">
              <p>No saved studies yet. Start a new word study to see it here.</p>
            </div>
          } @else {
            <div
              class="is-flex is-flex-wrap-wrap is-align-items-center mb-3"
              data-testid="list-controls"
            >
              <div class="field is-flex is-align-items-center mb-0 mr-4">
                <label class="label is-small mb-0 mr-2" for="language-filter">Language</label>
                <div class="select is-small">
                  <select
                    id="language-filter"
                    [value]="languageFilter()"
                    (change)="languageFilter.set($any($event.target).value)"
                    data-testid="language-filter"
                  >
                    <option value="all">All</option>
                    <option value="greek">Greek</option>
                    <option value="hebrew">Hebrew</option>
                    <option value="none">No Strong's number</option>
                  </select>
                </div>
              </div>
              @if (books().length > 0) {
                <div class="field is-flex is-align-items-center mb-0 mr-4">
                  <label class="label is-small mb-0 mr-2" for="book-filter">Book</label>
                  <div class="select is-small">
                    <select
                      id="book-filter"
                      [value]="bookFilter()"
                      (change)="bookFilter.set($any($event.target).value)"
                      data-testid="book-filter"
                    >
                      <option value="all">All</option>
                      <option value="none">No book</option>
                      @for (b of books(); track b.id) {
                        <option [value]="b.id">{{ b.book }}</option>
                      }
                    </select>
                  </div>
                </div>
              }
              <label class="checkbox is-size-7">
                <input
                  type="checkbox"
                  [checked]="groupWords()"
                  (change)="groupWords.set($any($event.target).checked)"
                  data-testid="group-by-word"
                />
                Group studies of the same English word
              </label>
            </div>
            <div class="table-container">
              <table class="table is-fullwidth is-hoverable" aria-label="Saved studies list">
                <thead>
                  <tr>
                    @for (col of columns; track col.key) {
                      <th scope="col" [attr.aria-sort]="ariaSort(col.key)">
                        <button
                          type="button"
                          class="button is-ghost p-0 has-text-weight-bold"
                          (click)="setSort(col.key)"
                          [attr.data-testid]="'sort-' + col.key"
                        >
                          {{ col.label }}<span aria-hidden="true">{{ sortArrow(col.key) }}</span>
                        </button>
                      </th>
                    }
                    <th scope="col"><span class="is-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track $index) {
                    @if (row.kind === 'group') {
                      <tr class="has-background-light" data-testid="group-row">
                        <th scope="colgroup" colspan="6">
                          {{ row.word }}
                          <span class="has-text-grey has-text-weight-normal">
                            — {{ row.count }} studies{{
                              row.strongs.length ? ': ' + row.strongs.join(', ') : ''
                            }}
                          </span>
                        </th>
                      </tr>
                    } @else {
                      <tr data-testid="study-row">
                        <td data-testid="study-word">{{ firstWord(row.study) }}</td>
                        <td data-testid="study-strongs">{{ firstStrongsNumber(row.study) }}</td>
                        <td data-testid="study-language">{{ languageLabel(row.study) }}</td>
                        <td data-testid="study-books">{{ booksFor(row.study) }}</td>
                        <td data-testid="study-date">{{ row.study.updatedAt | date: 'medium' }}</td>
                        <td>
                          <div class="buttons are-small">
                            <button
                              class="button is-link is-outlined"
                              (click)="openStudy(row.study)"
                              [attr.aria-label]="'Open study for ' + firstWord(row.study)"
                              data-testid="open-study-button"
                            >
                              Open
                            </button>
                            <button
                              class="button is-danger is-outlined"
                              (click)="confirmDelete(row.study)"
                              [attr.aria-label]="'Delete study for ' + firstWord(row.study)"
                              data-testid="delete-study-button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
            <p class="is-size-7 has-text-grey" data-testid="study-count">
              {{ visibleStudies().length }} study(ies) found
            </p>
          }
        }
      </div>
    </section>

    @if (studyToDelete()) {
      <div class="modal is-active" data-testid="delete-modal">
        <div class="modal-background" aria-hidden="true" (click)="cancelDelete()"></div>
        <div
          class="modal-card"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          aria-describedby="delete-modal-body"
        >
          <header class="modal-card-head">
            <p class="modal-card-title" id="delete-modal-title">Delete Study</p>
            <button
              class="delete"
              aria-label="Close"
              (click)="cancelDelete()"
              data-testid="delete-modal-close"
            ></button>
          </header>
          <section class="modal-card-body" id="delete-modal-body">
            <p>
              Are you sure you want to delete the study for
              <strong>{{ firstWord(studyToDelete()!) }}</strong>
              ({{ firstStrongsNumber(studyToDelete()!) }})? This action cannot be undone.
            </p>
          </section>
          <footer class="modal-card-foot">
            <div class="buttons">
              <button
                class="button is-danger"
                [class.is-loading]="deleting()"
                [disabled]="deleting()"
                (click)="deleteStudy()"
                data-testid="confirm-delete-button"
              >
                Delete
              </button>
              <button
                class="button"
                (click)="cancelDelete()"
                [disabled]="deleting()"
                data-testid="cancel-delete-button"
              >
                Cancel
              </button>
            </div>
          </footer>
        </div>
      </div>
    }

    @if (deleteError()) {
      <div class="notification is-danger mt-3" role="alert" data-testid="delete-error">
        <button class="delete" (click)="deleteError.set('')" aria-label="Dismiss error"></button>
        {{ deleteError() }}
      </div>
    }
  `,
})
export class StudyListComponent implements OnInit {
  private readonly studyCrud = inject(StudyCrudService);
  private readonly bookStudyService = inject(BookStudyService);
  private readonly router = inject(Router);

  readonly state = signal<ListState>('idle');
  readonly studies = signal<StudyWorksheet[]>([]);

  /** The student's books, for the Books column and filter. Failure leaves them empty (column shows —). */
  readonly books = signal<BookStudy[]>([]);
  readonly bookFilter = signal<BookFilter>('all');

  readonly languageFilter = signal<LanguageFilter>('all');
  readonly sort = signal<SortState>(DEFAULT_SORT);
  /** When on, studies of the same English word sit together under a heading. */
  readonly groupWords = signal(false);

  /** Table columns, in order. */
  readonly columns: readonly { key: SortKey; label: string }[] = [
    { key: 'word', label: 'Word' },
    { key: 'strongs', label: "Strong's #" },
    { key: 'language', label: 'Language' },
    { key: 'books', label: 'Books' },
    { key: 'updated', label: 'Last Updated' },
  ];

  /** Studies passing the book and language filters, in the chosen order. */
  readonly visibleStudies = computed(() =>
    sortStudies(
      this.studies().filter(
        (s) =>
          matchesBookFilter(s.bookStudyIds ?? [], this.books(), this.bookFilter()) &&
          matchesLanguage(s, this.languageFilter()),
      ),
      this.sort(),
      (s) => bookNames(s.bookStudyIds ?? [], this.books()).replace(/^—$/, ''),
    ),
  );

  /** What the table shows: the studies, optionally grouped under a heading per shared English word. */
  readonly rows = computed(() =>
    this.groupWords() ? groupByWord(this.visibleStudies()) : plainRows(this.visibleStudies()),
  );

  setSort(key: SortKey): void {
    this.sort.set(nextSort(this.sort(), key));
  }

  /** The `aria-sort` value for a column header. */
  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    const s = this.sort();
    return s.key === key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  sortArrow(key: SortKey): string {
    const s = this.sort();
    return s.key === key ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
  }

  languageLabel(study: StudyWorksheet): string {
    return LANGUAGE_LABELS[languageOf(study.wordStudies[0]?.strongsNumber)];
  }

  booksFor(study: StudyWorksheet): string {
    return bookNames(study.bookStudyIds ?? [], this.books());
  }

  /** The study currently pending deletion confirmation. */
  readonly studyToDelete = signal<StudyWorksheet | null>(null);

  /** Whether a delete API call is in progress. */
  readonly deleting = signal(false);

  /** Error message from a failed delete attempt. */
  readonly deleteError = signal('');

  ngOnInit(): void {
    this.loadStudies();
    this.bookStudyService.list().subscribe({
      next: (books) => this.books.set(books),
      error: () => this.books.set([]),
    });
  }

  loadStudies(): void {
    this.state.set('loading');
    this.studyCrud.listStudies().subscribe({
      next: (studies) => {
        this.studies.set(studies);
        this.state.set('loaded');
      },
      error: () => {
        this.state.set('error');
      },
    });
  }

  openStudy(study: StudyWorksheet): void {
    this.router.navigate(['/study', study.id]);
  }

  /** Show the confirmation modal for deleting a study. */
  confirmDelete(study: StudyWorksheet): void {
    this.deleteError.set('');
    this.studyToDelete.set(study);
  }

  /** Close the confirmation modal without deleting. */
  cancelDelete(): void {
    this.studyToDelete.set(null);
  }

  /** Execute the delete after confirmation. */
  deleteStudy(): void {
    const study = this.studyToDelete();
    if (!study) return;

    this.deleting.set(true);
    this.deleteError.set('');

    this.studyCrud.deleteStudy(study.id).subscribe({
      next: () => {
        this.studies.update((list) => list.filter((s) => s.id !== study.id));
        this.studyToDelete.set(null);
        this.deleting.set(false);
      },
      error: () => {
        this.studyToDelete.set(null);
        this.deleting.set(false);
        this.deleteError.set('Failed to delete study. Please try again.');
      },
    });
  }

  firstWord(study: StudyWorksheet): string {
    return study.wordStudies[0]?.word ?? '—';
  }

  firstStrongsNumber(study: StudyWorksheet): string {
    return study.wordStudies[0]?.strongsNumber ?? '—';
  }
}
