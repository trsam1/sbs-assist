import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { BookStudy } from '../models';
import { BookBundle, failedParts } from './book-bundle';
import { BookBundleService } from './book-bundle.service';
import { DEFAULT_EXPORT_OPTIONS, ExportOptions, fileName, toJson, toMarkdown } from './book-export';
import { DOWNLOAD_FILE } from './download';

type ExportState = 'idle' | 'working' | 'error';

/**
 * Book home's Export control: download the book's work as a readable document or a JSON backup. The file is
 * built in the browser from the same data the tool pages use and is never uploaded.
 */
@Component({
  selector: 'app-book-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="box" data-testid="book-export">
      <summary class="has-text-weight-semibold">Export this book's work</summary>

      <p class="help mt-2">
        Downloads a file to this device. Nothing is uploaded. Scroll text is left out unless you
        tick the box.
      </p>

      <div class="field mt-3">
        <label class="checkbox mr-4">
          <input
            type="checkbox"
            [checked]="includeScroll()"
            (change)="includeScroll.set($any($event.target).checked)"
            data-testid="export-include-scroll"
          />
          Include scroll text
        </label>
        <label class="checkbox">
          <input
            type="checkbox"
            [checked]="includeWordStudies()"
            (change)="includeWordStudies.set($any($event.target).checked)"
            data-testid="export-include-words"
          />
          Include word studies
        </label>
      </div>

      <div class="buttons are-small">
        <button
          type="button"
          class="button is-link is-outlined"
          [disabled]="state() === 'working'"
          (click)="export('md')"
          data-testid="export-markdown"
        >
          Download document (.md)
        </button>
        <button
          type="button"
          class="button is-link is-outlined"
          [disabled]="state() === 'working'"
          (click)="export('json')"
          data-testid="export-json"
        >
          Download backup (.json)
        </button>
      </div>

      <p class="is-size-7" aria-live="polite" data-testid="export-status">
        @switch (state()) {
          @case ('working') {
            Gathering this book's work…
          }
          @case ('error') {
            <span class="has-text-danger">The export could not be created. Please try again.</span>
          }
          @default {
            @if (notIncluded()) {
              <span class="has-text-warning-dark" data-testid="export-partial">
                Last export did not include: {{ notIncluded() }}.
              </span>
            }
          }
        }
      </p>
    </details>
  `,
})
export class BookExportComponent {
  private readonly bundles = inject(BookBundleService);
  private readonly download = inject(DOWNLOAD_FILE);

  readonly book = input.required<BookStudy>();
  /** The book's scroll study id, or '' when it has none yet. */
  readonly scrollStudyId = input<string>('');

  readonly includeScroll = signal(DEFAULT_EXPORT_OPTIONS.includeScroll);
  readonly includeWordStudies = signal(DEFAULT_EXPORT_OPTIONS.includeWordStudies);
  readonly state = signal<ExportState>('idle');
  private readonly missing = signal<string[]>([]);
  readonly notIncluded = computed(() => this.missing().join(', '));

  /** Load the book's work, build the file, hand it to the browser. */
  export(kind: 'md' | 'json'): void {
    if (this.state() === 'working') return;
    this.state.set('working');
    this.missing.set([]);
    this.bundles.load(this.book(), this.scrollStudyId()).subscribe({
      next: (bundle) => this.finish(bundle, kind),
      error: () => this.state.set('error'),
    });
  }

  private finish(bundle: BookBundle, kind: 'md' | 'json'): void {
    try {
      const now = new Date();
      const options: ExportOptions = {
        includeScroll: this.includeScroll(),
        includeWordStudies: this.includeWordStudies(),
        now,
      };
      const content = kind === 'md' ? toMarkdown(bundle, options) : toJson(bundle, options);
      this.download({
        name: fileName(bundle.book.book, kind, now),
        mimeType: kind === 'md' ? 'text/markdown' : 'application/json',
        content,
      });
      this.missing.set(failedParts(bundle));
      this.state.set('idle');
    } catch {
      this.state.set('error');
    }
  }
}
