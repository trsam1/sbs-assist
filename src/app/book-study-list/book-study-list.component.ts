import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { BookStudyService } from '../book-study.service';
import { BookStudy } from '../models';

export type ListState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-book-study-list',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Book studies">
      <div class="container">
        <div class="level">
          <div class="level-left">
            <h2 class="title is-4">Book Studies</h2>
          </div>
          <div class="level-right">
            <button
              class="button is-primary"
              (click)="newBookStudy()"
              data-testid="new-book-study-button"
            >
              New Book Study
            </button>
          </div>
        </div>

        @if (state() === 'loading') {
          <div
            class="has-text-centered py-5"
            aria-live="polite"
            aria-busy="true"
            data-testid="loading"
          >
            <p>Loading your book studies…</p>
          </div>
        }

        @if (state() === 'error') {
          <div class="notification is-danger" role="alert" data-testid="error">
            <p>Failed to load book studies. Please try again.</p>
            <button
              class="button is-danger is-outlined is-small mt-2"
              (click)="loadBookStudies()"
              data-testid="retry-button"
            >
              Retry
            </button>
          </div>
        }

        @if (state() === 'loaded') {
          @if (bookStudies().length === 0) {
            <div class="box has-text-centered has-text-grey" data-testid="empty-state">
              <p>No book studies yet. Create one to organize your work by book of the Bible.</p>
            </div>
          } @else {
            <div class="table-container">
              <table class="table is-fullwidth is-hoverable" aria-label="Book studies list">
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Book</th>
                    <th scope="col">Last Updated</th>
                    <th scope="col"><span class="is-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (bookStudy of bookStudies(); track bookStudy.id) {
                    <tr data-testid="book-study-row">
                      <td data-testid="book-study-title">{{ displayTitle(bookStudy) }}</td>
                      <td data-testid="book-study-book">{{ bookStudy.book }}</td>
                      <td data-testid="book-study-date">
                        {{ bookStudy.updatedAt | date: 'medium' }}
                      </td>
                      <td>
                        <div class="buttons are-small">
                          <button
                            class="button is-link is-outlined"
                            (click)="openBookStudy(bookStudy)"
                            [attr.aria-label]="'Open book study ' + displayTitle(bookStudy)"
                            data-testid="open-book-study-button"
                          >
                            Open
                          </button>
                          <button
                            class="button is-danger is-outlined"
                            (click)="confirmDelete(bookStudy)"
                            [attr.aria-label]="'Delete book study ' + displayTitle(bookStudy)"
                            data-testid="delete-book-study-button"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="is-size-7 has-text-grey" data-testid="book-study-count">
              {{ bookStudies().length }} book study(ies) found
            </p>
          }
        }
      </div>
    </section>

    @if (bookStudyToDelete()) {
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
            <p class="modal-card-title" id="delete-modal-title">Delete Book Study</p>
            <button
              class="delete"
              aria-label="Close"
              (click)="cancelDelete()"
              data-testid="delete-modal-close"
            ></button>
          </header>
          <section class="modal-card-body" id="delete-modal-body">
            <p>
              Are you sure you want to delete the book study
              <strong>{{ displayTitle(bookStudyToDelete()!) }}</strong>
              ({{ bookStudyToDelete()!.book }})? This action cannot be undone.
            </p>
          </section>
          <footer class="modal-card-foot">
            <div class="buttons">
              <button
                class="button is-danger"
                [class.is-loading]="deleting()"
                [disabled]="deleting()"
                (click)="deleteBookStudy()"
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
export class BookStudyListComponent implements OnInit {
  private readonly bookStudyService = inject(BookStudyService);
  private readonly router = inject(Router);

  readonly state = signal<ListState>('idle');
  readonly bookStudies = signal<BookStudy[]>([]);

  /** The book study currently pending deletion confirmation. */
  readonly bookStudyToDelete = signal<BookStudy | null>(null);

  /** Whether a delete API call is in progress. */
  readonly deleting = signal(false);

  /** Error message from a failed delete attempt. */
  readonly deleteError = signal('');

  ngOnInit(): void {
    this.loadBookStudies();
  }

  loadBookStudies(): void {
    this.state.set('loading');
    this.bookStudyService.list().subscribe({
      next: (bookStudies) => {
        this.bookStudies.set(bookStudies);
        this.state.set('loaded');
      },
      error: () => {
        this.state.set('error');
      },
    });
  }

  newBookStudy(): void {
    this.router.navigate(['/books/new']);
  }

  openBookStudy(bookStudy: BookStudy): void {
    this.router.navigate(['/books', bookStudy.id]);
  }

  /** Show the confirmation modal for deleting a book study. */
  confirmDelete(bookStudy: BookStudy): void {
    this.deleteError.set('');
    this.bookStudyToDelete.set(bookStudy);
  }

  /** Close the confirmation modal without deleting. */
  cancelDelete(): void {
    this.bookStudyToDelete.set(null);
  }

  /** Execute the delete after confirmation. */
  deleteBookStudy(): void {
    const bookStudy = this.bookStudyToDelete();
    if (!bookStudy) return;

    this.deleting.set(true);
    this.deleteError.set('');

    this.bookStudyService.delete(bookStudy.id).subscribe({
      next: () => {
        this.bookStudies.update((list) => list.filter((b) => b.id !== bookStudy.id));
        this.bookStudyToDelete.set(null);
        this.deleting.set(false);
      },
      error: () => {
        this.bookStudyToDelete.set(null);
        this.deleting.set(false);
        this.deleteError.set('Failed to delete book study. Please try again.');
      },
    });
  }

  /** Display title falls back to the book name when title is empty. */
  displayTitle(bookStudy: BookStudy): string {
    return bookStudy.title.trim() ? bookStudy.title : bookStudy.book;
  }
}
