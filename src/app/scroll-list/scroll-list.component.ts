import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ScrollStudy, ScrollStudyService, ScrollStatus } from '../scroll-study.service';

export type ListState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-scroll-list',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Saved scroll studies">
      <div class="container">
        <h2 class="title is-4">My Scroll Studies</h2>

        @if (state() === 'loading') {
          <div
            class="has-text-centered py-5"
            aria-live="polite"
            aria-busy="true"
            data-testid="scroll-loading"
          >
            <p>Loading your scroll studies…</p>
          </div>
        }

        @if (state() === 'error') {
          <div class="notification is-danger" role="alert" data-testid="scroll-error">
            <p>Failed to load scroll studies. Please try again.</p>
            <button
              class="button is-danger is-outlined is-small mt-2"
              (click)="loadScrollStudies()"
              data-testid="scroll-retry-button"
            >
              Retry
            </button>
          </div>
        }

        @if (state() === 'loaded') {
          @if (studies().length === 0) {
            <div class="box has-text-centered has-text-grey" data-testid="scroll-empty-state">
              <p>No scroll studies yet. Upload a document to start one.</p>
            </div>
          } @else {
            <div class="table-container">
              <table class="table is-fullwidth is-hoverable" aria-label="Saved scroll studies list">
                <thead>
                  <tr>
                    <th scope="col">Book</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last Updated</th>
                    <th scope="col"><span class="is-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (study of studies(); track study.id) {
                    <tr data-testid="scroll-row">
                      <td data-testid="scroll-book">{{ study.bookName }}</td>
                      <td>
                        <span
                          class="tag"
                          [class.is-warning]="isPending(study.status)"
                          [class.is-success]="study.status === 'ready'"
                          [class.is-danger]="study.status === 'failed'"
                          data-testid="scroll-status"
                          >{{ study.status }}</span
                        >
                      </td>
                      <td data-testid="scroll-date">{{ study.updatedAt | date: 'medium' }}</td>
                      <td>
                        <div class="buttons are-small">
                          <button
                            class="button is-link is-outlined"
                            (click)="openScrollStudy(study)"
                            [attr.aria-label]="'Open scroll study for ' + study.bookName"
                            data-testid="open-scroll-button"
                          >
                            Open
                          </button>
                          <button
                            class="button is-danger is-outlined"
                            (click)="confirmDelete(study)"
                            [attr.aria-label]="'Delete scroll study for ' + study.bookName"
                            data-testid="delete-scroll-button"
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
            <p class="is-size-7 has-text-grey" data-testid="scroll-count">
              {{ studies().length }} scroll study(ies) found
            </p>
          }
        }
      </div>
    </section>

    @if (studyToDelete()) {
      <div class="modal is-active" data-testid="scroll-delete-modal">
        <div class="modal-background" aria-hidden="true" (click)="cancelDelete()"></div>
        <div
          class="modal-card"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="scroll-delete-modal-title"
          aria-describedby="scroll-delete-modal-body"
        >
          <header class="modal-card-head">
            <p class="modal-card-title" id="scroll-delete-modal-title">Delete Scroll Study</p>
            <button
              class="delete"
              aria-label="Close"
              (click)="cancelDelete()"
              data-testid="scroll-delete-modal-close"
            ></button>
          </header>
          <section class="modal-card-body" id="scroll-delete-modal-body">
            <p>
              Are you sure you want to delete the scroll study for
              <strong>{{ studyToDelete()!.bookName }}</strong
              >? This action cannot be undone.
            </p>
          </section>
          <footer class="modal-card-foot">
            <div class="buttons">
              <button
                class="button is-danger"
                [class.is-loading]="deleting()"
                [disabled]="deleting()"
                (click)="deleteScrollStudy()"
                data-testid="confirm-scroll-delete-button"
              >
                Delete
              </button>
              <button
                class="button"
                (click)="cancelDelete()"
                [disabled]="deleting()"
                data-testid="cancel-scroll-delete-button"
              >
                Cancel
              </button>
            </div>
          </footer>
        </div>
      </div>
    }

    @if (deleteError()) {
      <div class="notification is-danger mt-3" role="alert" data-testid="scroll-delete-error">
        <button class="delete" (click)="deleteError.set('')" aria-label="Dismiss error"></button>
        {{ deleteError() }}
      </div>
    }
  `,
})
export class ScrollListComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly router = inject(Router);

  readonly state = signal<ListState>('idle');
  readonly studies = signal<ScrollStudy[]>([]);

  readonly studyToDelete = signal<ScrollStudy | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal('');

  ngOnInit(): void {
    this.loadScrollStudies();
  }

  loadScrollStudies(): void {
    this.state.set('loading');
    this.scrollStudy.listScrollStudies().subscribe({
      next: (studies) => {
        const sorted = [...studies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        this.studies.set(sorted);
        this.state.set('loaded');
      },
      error: () => {
        this.state.set('error');
      },
    });
  }

  isPending(status: ScrollStatus): boolean {
    return status === 'uploading' || status === 'extracting';
  }

  openScrollStudy(study: ScrollStudy): void {
    this.router.navigate(['/scroll', study.id]);
  }

  confirmDelete(study: ScrollStudy): void {
    this.deleteError.set('');
    this.studyToDelete.set(study);
  }

  cancelDelete(): void {
    this.studyToDelete.set(null);
  }

  deleteScrollStudy(): void {
    const study = this.studyToDelete();
    if (!study) return;

    this.deleting.set(true);
    this.deleteError.set('');

    this.scrollStudy.deleteScrollStudy(study.id).subscribe({
      next: () => {
        this.studies.update((list) => list.filter((s) => s.id !== study.id));
        this.studyToDelete.set(null);
        this.deleting.set(false);
      },
      error: () => {
        this.studyToDelete.set(null);
        this.deleting.set(false);
        this.deleteError.set('Failed to delete scroll study. Please try again.');
      },
    });
  }
}
