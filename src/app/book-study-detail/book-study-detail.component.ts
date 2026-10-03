import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BookStudyService } from '../book-study.service';
import { BookStudy } from '../models';

type DetailState = 'loading' | 'loaded' | 'notfound' | 'error';

@Component({
  selector: 'app-book-study-detail',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Book study detail">
      <div class="container">
        <a routerLink="/books" class="button is-light is-small mb-4" data-testid="back-link">
          ← Back to Book Studies
        </a>

        @if (state() === 'loading') {
          <div
            class="has-text-centered py-5"
            aria-live="polite"
            aria-busy="true"
            data-testid="loading"
          >
            <p>Loading book study…</p>
          </div>
        }

        @if (state() === 'notfound') {
          <div class="notification is-warning" role="alert" data-testid="not-found">
            <p>
              That book study could not be found.
              <a routerLink="/books">Return to your book studies.</a>
            </p>
          </div>
        }

        @if (state() === 'error') {
          <div class="notification is-danger" role="alert" data-testid="error">
            <p>Failed to load book study. Please try again.</p>
            <button
              class="button is-danger is-outlined is-small mt-2"
              (click)="reload()"
              data-testid="retry-button"
            >
              Retry
            </button>
          </div>
        }

        @if (state() === 'loaded' && bookStudy(); as bs) {
          <h2 class="title is-4" data-testid="detail-book">{{ bs.book }}</h2>

          @if (bs.title.trim()) {
            <p class="subtitle is-6" data-testid="detail-title">{{ bs.title }}</p>
          }

          @if (bs.notes.trim()) {
            <div class="content" data-testid="detail-notes">
              <p style="white-space: pre-wrap">{{ bs.notes }}</p>
            </div>
          }

          <p class="is-size-7 has-text-grey" data-testid="detail-timestamps">
            Created {{ bs.createdAt | date: 'medium' }} · Updated
            {{ bs.updatedAt | date: 'medium' }}
          </p>

          <div class="buttons mt-4">
            <button
              class="button is-danger is-outlined"
              (click)="confirmDelete()"
              data-testid="delete-button"
            >
              Delete
            </button>
          </div>
        }
      </div>
    </section>

    @if (showDeleteModal()) {
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
            <p>Are you sure you want to delete this book study? This action cannot be undone.</p>
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
export class BookStudyDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bookStudyService = inject(BookStudyService);

  readonly state = signal<DetailState>('loading');
  readonly bookStudy = signal<BookStudy | null>(null);

  readonly showDeleteModal = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal('');

  private bookStudyId = '';

  ngOnInit(): void {
    this.bookStudyId = this.route.snapshot.paramMap.get('bookStudyId') ?? '';
    this.load();
  }

  reload(): void {
    this.load();
  }

  private load(): void {
    this.state.set('loading');
    this.bookStudyService.get(this.bookStudyId).subscribe({
      next: (bookStudy) => {
        this.bookStudy.set(bookStudy);
        this.state.set('loaded');
      },
      error: (err: { status?: number }) => {
        this.state.set(err?.status === 404 ? 'notfound' : 'error');
      },
    });
  }

  confirmDelete(): void {
    this.deleteError.set('');
    this.showDeleteModal.set(true);
  }

  cancelDelete(): void {
    this.showDeleteModal.set(false);
  }

  deleteBookStudy(): void {
    this.deleting.set(true);
    this.deleteError.set('');

    this.bookStudyService.delete(this.bookStudyId).subscribe({
      next: () => {
        this.deleting.set(false);
        this.showDeleteModal.set(false);
        this.router.navigate(['/books']);
      },
      error: () => {
        this.deleting.set(false);
        this.showDeleteModal.set(false);
        this.deleteError.set('Failed to delete book study. Please try again.');
      },
    });
  }
}
