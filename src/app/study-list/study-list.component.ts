import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { StudyCrudService } from '../study-crud.service';
import { StudyWorksheet } from '../models';

export type ListState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-study-list',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Saved word studies">
      <div class="container">
        <h2 class="title is-4">My Word Studies</h2>

        @if (state() === 'loading') {
          <div class="has-text-centered py-5" aria-live="polite" aria-busy="true" data-testid="loading">
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
            <div class="table-container">
              <table class="table is-fullwidth is-hoverable" aria-label="Saved studies list">
                <thead>
                  <tr>
                    <th scope="col">Word</th>
                    <th scope="col">Strong's #</th>
                    <th scope="col">Last Updated</th>
                    <th scope="col"><span class="is-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (study of studies(); track study.id) {
                    <tr data-testid="study-row">
                      <td data-testid="study-word">{{ firstWord(study) }}</td>
                      <td data-testid="study-strongs">{{ firstStrongsNumber(study) }}</td>
                      <td data-testid="study-date">{{ study.updatedAt | date:'medium' }}</td>
                      <td>
                        <div class="buttons are-small">
                          <button
                            class="button is-link is-outlined"
                            (click)="openStudy(study)"
                            [attr.aria-label]="'Open study for ' + firstWord(study)"
                            data-testid="open-study-button"
                          >
                            Open
                          </button>
                          <button
                            class="button is-danger is-outlined"
                            (click)="confirmDelete(study)"
                            [attr.aria-label]="'Delete study for ' + firstWord(study)"
                            data-testid="delete-study-button"
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
            <p class="is-size-7 has-text-grey" data-testid="study-count">
              {{ studies().length }} study(ies) found
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
              ({{ firstStrongsNumber(studyToDelete()!) }})?
              This action cannot be undone.
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
  private readonly router = inject(Router);

  readonly state = signal<ListState>('idle');
  readonly studies = signal<StudyWorksheet[]>([]);

  /** The study currently pending deletion confirmation. */
  readonly studyToDelete = signal<StudyWorksheet | null>(null);

  /** Whether a delete API call is in progress. */
  readonly deleting = signal(false);

  /** Error message from a failed delete attempt. */
  readonly deleteError = signal('');

  ngOnInit(): void {
    this.loadStudies();
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
