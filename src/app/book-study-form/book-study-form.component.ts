import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { BookStudyService } from '../book-study.service';
import { OLD_TESTAMENT_BOOKS, NEW_TESTAMENT_BOOKS } from '../bible-books';

type SaveState = 'idle' | 'saving' | 'error';

@Component({
  selector: 'app-book-study-form',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="New book study">
      <div class="container">
        <h2 class="title is-4">New Book Study</h2>

        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="box">
          <div class="field">
            <label class="label" for="book-select">Book of the Bible</label>
            <div class="control">
              <div class="select is-fullwidth">
                <select
                  id="book-select"
                  formControlName="book"
                  aria-required="true"
                  data-testid="book-select"
                >
                  <option value="" disabled>Choose a book…</option>
                  <optgroup label="Old Testament">
                    @for (book of oldTestamentBooks; track book) {
                      <option [value]="book">{{ book }}</option>
                    }
                  </optgroup>
                  <optgroup label="New Testament">
                    @for (book of newTestamentBooks; track book) {
                      <option [value]="book">{{ book }}</option>
                    }
                  </optgroup>
                </select>
              </div>
            </div>
          </div>

          <div class="field">
            <label class="label" for="title-input">Title (optional)</label>
            <div class="control">
              <input
                id="title-input"
                class="input"
                type="text"
                formControlName="title"
                maxlength="200"
                placeholder="e.g. Summer study of Genesis"
                data-testid="title-input"
              />
            </div>
          </div>

          <div class="field">
            <label class="label" for="notes-input">Notes (optional)</label>
            <div class="control">
              <textarea
                id="notes-input"
                class="textarea"
                formControlName="notes"
                maxlength="2000"
                placeholder="What are you focusing on for this book?"
                data-testid="notes-input"
              ></textarea>
            </div>
          </div>

          @if (saveState() === 'error') {
            <div class="notification is-danger" role="alert" data-testid="save-error">
              <button
                class="delete"
                type="button"
                (click)="saveState.set('idle')"
                aria-label="Dismiss error"
              ></button>
              Failed to save the book study. Please try again.
            </div>
          }

          <div class="field is-grouped">
            <div class="control">
              <button
                type="submit"
                class="button is-primary"
                [class.is-loading]="saveState() === 'saving'"
                [disabled]="form.invalid || saveState() === 'saving'"
                data-testid="save-button"
              >
                Save
              </button>
            </div>
            <div class="control">
              <button
                type="button"
                class="button is-light"
                (click)="cancel()"
                data-testid="cancel-button"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  `,
})
export class BookStudyFormComponent {
  private readonly bookStudyService = inject(BookStudyService);
  private readonly router = inject(Router);

  readonly oldTestamentBooks = OLD_TESTAMENT_BOOKS;
  readonly newTestamentBooks = NEW_TESTAMENT_BOOKS;

  readonly saveState = signal<SaveState>('idle');

  readonly form = new FormGroup({
    book: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saveState.set('saving');
    const { book, title, notes } = this.form.getRawValue();

    this.bookStudyService.create({ book, title, notes }).subscribe({
      next: () => {
        this.router.navigate(['/books']);
      },
      error: () => {
        this.saveState.set('error');
      },
    });
  }

  cancel(): void {
    this.router.navigate(['/books']);
  }
}
