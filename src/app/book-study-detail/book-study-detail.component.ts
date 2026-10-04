import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BookStudyService } from '../book-study.service';
import { BookStudy, Referent } from '../models';

type DetailState = 'loading' | 'loaded' | 'notfound' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const REFERENT_FIELD_MAX = 200;
const REFERENT_LONG_MAX = 1000;

@Component({
  selector: 'app-book-study-detail',
  imports: [DatePipe, RouterLink, FormsModule],
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

          <section class="mt-5" aria-label="Referents" data-testid="referents-section">
            <h3 class="title is-5">Referents</h3>
            <p class="is-size-7 has-text-grey mb-4">
              Document the descriptive phrases you find and what each one refers to.
            </p>

            @if (referents().length === 0) {
              <p class="has-text-grey mb-4" data-testid="referents-empty">
                No referents yet. Add one below.
              </p>
            } @else {
              <div class="mb-4">
                @for (ref of referents(); track $index) {
                  <div class="box" data-testid="referent-row">
                    <div class="field">
                      <label class="label is-small" [for]="'referent-phrase-' + $index"
                        >Phrase</label
                      >
                      <div class="control">
                        <input
                          class="input"
                          type="text"
                          [id]="'referent-phrase-' + $index"
                          [attr.maxlength]="REFERENT_FIELD_MAX"
                          [value]="ref.phrase"
                          (change)="updateReferent($index, 'phrase', $any($event.target).value)"
                          data-testid="referent-phrase"
                        />
                      </div>
                    </div>

                    <div class="field">
                      <label class="label is-small" [for]="'referent-refersto-' + $index"
                        >Refers to</label
                      >
                      <div class="control">
                        <input
                          class="input"
                          type="text"
                          [id]="'referent-refersto-' + $index"
                          [attr.maxlength]="REFERENT_FIELD_MAX"
                          [value]="ref.refersTo"
                          (change)="updateReferent($index, 'refersTo', $any($event.target).value)"
                          data-testid="referent-refersto"
                        />
                      </div>
                    </div>

                    <div class="field">
                      <label class="label is-small" [for]="'referent-notes-' + $index">Notes</label>
                      <div class="control">
                        <textarea
                          class="textarea"
                          rows="2"
                          [id]="'referent-notes-' + $index"
                          [attr.maxlength]="REFERENT_LONG_MAX"
                          [value]="ref.notes"
                          (change)="updateReferent($index, 'notes', $any($event.target).value)"
                          data-testid="referent-notes"
                        ></textarea>
                      </div>
                    </div>

                    <div class="field">
                      <label class="label is-small" [for]="'referent-scrollref-' + $index"
                        >Scroll text reference (optional)</label
                      >
                      <div class="control">
                        <input
                          class="input"
                          type="text"
                          [id]="'referent-scrollref-' + $index"
                          [attr.maxlength]="REFERENT_LONG_MAX"
                          [value]="ref.scrollRef"
                          (change)="updateReferent($index, 'scrollRef', $any($event.target).value)"
                          data-testid="referent-scrollref"
                        />
                      </div>
                    </div>

                    <button
                      class="button is-danger is-outlined is-small"
                      type="button"
                      (click)="removeReferent($index)"
                      data-testid="remove-referent-button"
                    >
                      Remove
                    </button>
                  </div>
                }
              </div>
            }

            <form
              class="box"
              (ngSubmit)="addReferent()"
              data-testid="add-referent-form"
              aria-label="Add referent"
            >
              <div class="field">
                <label class="label is-small" for="add-referent-phrase">Phrase</label>
                <div class="control">
                  <input
                    class="input"
                    type="text"
                    id="add-referent-phrase"
                    name="draftPhrase"
                    [attr.maxlength]="REFERENT_FIELD_MAX"
                    [(ngModel)]="draftPhrase"
                    data-testid="add-referent-phrase"
                  />
                </div>
              </div>

              <div class="field">
                <label class="label is-small" for="add-referent-refersto">Refers to</label>
                <div class="control">
                  <input
                    class="input"
                    type="text"
                    id="add-referent-refersto"
                    name="draftRefersTo"
                    [attr.maxlength]="REFERENT_FIELD_MAX"
                    [(ngModel)]="draftRefersTo"
                    data-testid="add-referent-refersto"
                  />
                </div>
              </div>

              <div class="field">
                <label class="label is-small" for="add-referent-notes">Notes (optional)</label>
                <div class="control">
                  <textarea
                    class="textarea"
                    rows="2"
                    id="add-referent-notes"
                    name="draftNotes"
                    [attr.maxlength]="REFERENT_LONG_MAX"
                    [(ngModel)]="draftNotes"
                    data-testid="add-referent-notes"
                  ></textarea>
                </div>
              </div>

              <div class="field">
                <label class="label is-small" for="add-referent-scrollref"
                  >Scroll text reference (optional)</label
                >
                <div class="control">
                  <input
                    class="input"
                    type="text"
                    id="add-referent-scrollref"
                    name="draftScrollRef"
                    [attr.maxlength]="REFERENT_LONG_MAX"
                    [(ngModel)]="draftScrollRef"
                    data-testid="add-referent-scrollref"
                  />
                </div>
              </div>

              @if (addError()) {
                <p
                  class="help is-danger"
                  role="alert"
                  aria-live="assertive"
                  data-testid="add-referent-error"
                >
                  {{ addError() }}
                </p>
              }

              <div class="control">
                <button
                  class="button is-link is-small"
                  type="submit"
                  data-testid="add-referent-button"
                >
                  Add referent
                </button>
              </div>
            </form>

            <div class="field is-grouped is-align-items-center mt-3">
              <div class="control">
                <button
                  class="button is-primary"
                  type="button"
                  [class.is-loading]="saveState() === 'saving'"
                  [disabled]="saveState() === 'saving'"
                  (click)="saveReferents()"
                  data-testid="save-referents-button"
                >
                  Save referents
                </button>
              </div>
              @if (saveState() === 'saved') {
                <p class="help is-success" aria-live="polite" data-testid="referents-saved">
                  Referents saved.
                </p>
              }
            </div>

            @if (saveState() === 'error') {
              <div
                class="notification is-danger mt-3"
                role="alert"
                aria-live="assertive"
                data-testid="referents-save-error"
              >
                {{ saveError() }}
              </div>
            }
          </section>

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

  // Referents section state.
  protected readonly REFERENT_FIELD_MAX = REFERENT_FIELD_MAX;
  protected readonly REFERENT_LONG_MAX = REFERENT_LONG_MAX;
  readonly referents = signal<Referent[]>([]);
  readonly addError = signal('');
  readonly saveState = signal<SaveState>('idle');
  readonly saveError = signal('');

  // Add-entry form model (bound via ngModel).
  draftPhrase = '';
  draftRefersTo = '';
  draftNotes = '';
  draftScrollRef = '';

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
        this.referents.set(bookStudy.referents ?? []);
        this.state.set('loaded');
      },
      error: (err: { status?: number }) => {
        this.state.set(err?.status === 404 ? 'notfound' : 'error');
      },
    });
  }

  /** Append a new referent from the draft form. Phrase and refers-to are required (after trim). */
  addReferent(): void {
    const phrase = this.draftPhrase.trim();
    const refersTo = this.draftRefersTo.trim();
    if (!phrase || !refersTo) {
      this.addError.set('Phrase and refers-to are required.');
      return;
    }

    const entry: Referent = {
      phrase,
      refersTo,
      notes: this.draftNotes,
      scrollRef: this.draftScrollRef,
    };
    this.referents.update((list) => [...list, entry]);

    this.draftPhrase = '';
    this.draftRefersTo = '';
    this.draftNotes = '';
    this.draftScrollRef = '';
    this.addError.set('');
    this.saveState.set('idle');
  }

  /**
   * Edit a field of an existing entry in place (preserving its position). A phrase/refers-to edit
   * that would blank the field after trim is rejected with the inline message and the prior value
   * is kept.
   */
  updateReferent(index: number, field: keyof Referent, value: string): void {
    const isRequired = field === 'phrase' || field === 'refersTo';
    if (isRequired && value.trim().length === 0) {
      this.addError.set('Phrase and refers-to are required.');
      // Re-assert the prior value so a bound control that pushed a blank is reverted.
      this.referents.update((list) => list.map((e, i) => (i === index ? { ...e } : e)));
      return;
    }

    this.addError.set('');
    this.referents.update((list) =>
      list.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    );
    this.saveState.set('idle');
  }

  /** Remove the entry at the given index. */
  removeReferent(index: number): void {
    this.referents.update((list) => list.filter((_, i) => i !== index));
    this.saveState.set('idle');
  }

  /** Persist the current referent list via an upsert, preserving the working list on error. */
  saveReferents(): void {
    const bs = this.bookStudy();
    if (!bs) return;

    this.saveState.set('saving');
    this.saveError.set('');

    this.bookStudyService
      .save({
        id: this.bookStudyId,
        book: bs.book,
        title: bs.title,
        notes: bs.notes,
        referents: this.referents(),
      })
      .subscribe({
        next: () => {
          this.saveState.set('saved');
          // Optimistic display-only update; the server-written value reconciles on next load.
          const now = new Date().toISOString();
          this.bookStudy.update((current) => (current ? { ...current, updatedAt: now } : current));
        },
        error: () => {
          this.saveState.set('error');
          this.saveError.set('Failed to save referents. Please try again.');
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
