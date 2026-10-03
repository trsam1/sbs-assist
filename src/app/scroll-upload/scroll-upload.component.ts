import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ScrollStudyService } from '../scroll-study.service';

/** Allowed upload extensions, lower-cased (mirrors the backend `uploadExtension`). */
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt'];

/** Client-side size gate: 10 MB. The authoritative gate is the extraction worker. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type UploadState = 'idle' | 'submitting' | 'error';

@Component({
  selector: 'app-scroll-upload',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="New scroll study">
      <div class="container">
        <h2 class="title is-4">New Scroll Study</h2>
        <p class="subtitle is-6">
          Upload a document (.pdf, .docx, or .txt) containing a book of the Bible in scroll form.
        </p>

        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="box">
          <div class="field">
            <label class="label" for="book-name-input">Book name</label>
            <div class="control">
              <input
                id="book-name-input"
                class="input"
                type="text"
                formControlName="bookName"
                maxlength="100"
                placeholder="e.g. Genesis, John, Romans"
                [class.is-danger]="showBookNameError()"
                aria-required="true"
                [attr.aria-invalid]="showBookNameError()"
                [attr.aria-describedby]="showBookNameError() ? 'book-name-error' : null"
                data-testid="book-name-input"
              />
            </div>
            @if (showBookNameError()) {
              <p id="book-name-error" class="help is-danger" role="alert">
                Please enter a book name (1–100 characters).
              </p>
            }
          </div>

          <div class="field">
            <label class="label" for="file-input">Document</label>
            <div class="control">
              <input
                id="file-input"
                class="input"
                type="file"
                accept=".pdf,.docx,.txt"
                (change)="onFileSelected($event)"
                aria-required="true"
                [attr.aria-describedby]="fileError() ? 'file-error' : null"
                data-testid="file-input"
              />
            </div>
            @if (fileError()) {
              <p id="file-error" class="help is-danger" role="alert" data-testid="file-error">
                {{ fileError() }}
              </p>
            }
          </div>

          @if (state() === 'error') {
            <div class="notification is-danger" role="alert" data-testid="upload-error">
              {{ errorMessage() }}
            </div>
          }

          <div class="field">
            <div class="control">
              <button
                type="submit"
                class="button is-primary"
                [class.is-loading]="state() === 'submitting'"
                [disabled]="state() === 'submitting'"
                data-testid="submit-button"
              >
                Upload
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  `,
})
export class ScrollUploadComponent {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly router = inject(Router);

  readonly state = signal<UploadState>('idle');
  readonly errorMessage = signal('');
  readonly fileError = signal('');

  /** The currently selected file, if valid so far. */
  private readonly selectedFile = signal<File | null>(null);

  readonly form = new FormGroup({
    bookName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
  });

  showBookNameError(): boolean {
    const control = this.form.controls.bookName;
    return control.invalid && (control.dirty || control.touched);
  }

  onFileSelected(event: Event): void {
    this.fileError.set('');
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
    if (file) {
      const error = this.validateFile(file);
      if (error) {
        this.fileError.set(error);
        this.selectedFile.set(null);
      }
    }
  }

  /** Returns an error message for a rejected file, or null when the file is acceptable. */
  private validateFile(file: File): string | null {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return 'Unsupported file type. Choose a .pdf, .docx, or .txt file.';
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return 'File is too large. The limit is 10 MB.';
    }
    return null;
  }

  onSubmit(): void {
    this.errorMessage.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      this.fileError.set('Please choose a document to upload.');
      return;
    }
    const fileError = this.validateFile(file);
    if (fileError) {
      this.fileError.set(fileError);
      return;
    }

    const bookName = this.form.getRawValue().bookName.trim();
    const contentType = file.type || 'application/octet-stream';
    this.state.set('submitting');

    this.scrollStudy.createScrollStudy({ bookName, filename: file.name, contentType }).subscribe({
      next: (res) => {
        this.scrollStudy.uploadBytes(res.uploadUrl, file).subscribe({
          next: () => {
            this.router.navigate(['/scroll', res.scrollStudyId]);
          },
          error: () => {
            // Keep the entered book name so the student can retry.
            this.state.set('error');
            this.errorMessage.set('Upload failed. Please try again.');
          },
        });
      },
      error: () => {
        this.state.set('error');
        this.errorMessage.set('Could not start the upload. Please try again.');
      },
    });
  }
}
