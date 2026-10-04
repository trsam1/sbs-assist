import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { AntecedentStudyService } from '../antecedent-study.service';
import { AntecedentAssignment } from '../models';
import { parsePronounOccurrences } from '../pronoun-parse';
import { suggestAntecedents } from '../antecedent-suggest';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

/** One worklist row: a pronoun occurrence plus its (editable) antecedent selection. */
interface OccurrenceRow {
  occurrence: number;
  start: number;
  word: string;
  snippet: string;
  antecedent: string;
}

/** Characters of context shown on each side of the pronoun token in a row's snippet. */
const SNIPPET_RADIUS = 30;

@Component({
  selector: 'app-antecedent-view',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Antecedent study">
      <div class="container">
        @if (study(); as s) {
          <h2 class="title is-4" data-testid="antecedent-book">{{ s.bookName }} — Antecedents</h2>
        }

        @switch (state()) {
          @case ('loading') {
            <div class="has-text-centered py-5" aria-live="polite" aria-busy="true">
              <p>Loading…</p>
            </div>
          }
          @case ('ready') {
            @if (rows().length === 0) {
              <div class="box" role="status" data-testid="antecedent-empty">
                No pronouns found in this scroll.
              </div>
            } @else {
              <p class="mb-3">
                Assign an antecedent to each pronoun occurrence. Pick a suggestion or type your own.
              </p>
              <table
                class="table is-striped is-fullwidth"
                aria-label="Pronoun occurrences and their antecedents"
                data-testid="antecedent-table"
              >
                <thead>
                  <tr>
                    <th>Pronoun</th>
                    <th>Context</th>
                    <th>Antecedent</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.occurrence) {
                    <tr data-testid="antecedent-row">
                      <td data-testid="antecedent-word">{{ row.word }}</td>
                      <td data-testid="antecedent-snippet">{{ row.snippet }}</td>
                      <td>
                        <div class="field has-addons">
                          <div class="control">
                            <div class="select is-small">
                              <select
                                [attr.aria-label]="
                                  'Antecedent for ' + row.word + ' at position ' + row.start
                                "
                                [ngModel]="row.antecedent"
                                (ngModelChange)="setAntecedent(row.occurrence, $event)"
                                data-testid="antecedent-select"
                              >
                                <option value="">— none —</option>
                                @for (opt of options(); track opt) {
                                  <option [value]="opt">{{ opt }}</option>
                                }
                              </select>
                            </div>
                          </div>
                          <div class="control">
                            <input
                              class="input is-small"
                              type="text"
                              maxlength="200"
                              placeholder="Add antecedent"
                              [attr.aria-label]="'Add a new antecedent for ' + row.word"
                              [ngModel]="draft(row.occurrence)"
                              (ngModelChange)="setDraft(row.occurrence, $event)"
                              data-testid="antecedent-add-input"
                            />
                          </div>
                          <div class="control">
                            <button
                              class="button is-small"
                              type="button"
                              (click)="addAntecedent(row.occurrence)"
                              data-testid="antecedent-add"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>

              <div class="field">
                <button
                  class="button is-primary"
                  type="button"
                  [class.is-loading]="saving()"
                  [disabled]="saving()"
                  (click)="save()"
                  data-testid="antecedent-save"
                >
                  Save
                </button>
              </div>

              <div aria-live="polite">
                @if (saved()) {
                  <p class="has-text-success" data-testid="antecedent-saved">Saved.</p>
                }
                @if (saveError()) {
                  <p class="has-text-danger" data-testid="antecedent-save-error">
                    Could not save. Your selections are still here — try again.
                  </p>
                }
              </div>
            }
          }
          @case ('preparing') {
            <div
              class="notification is-info"
              role="status"
              aria-live="polite"
              data-testid="antecedent-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="antecedent-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="antecedent-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="antecedent-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="antecedent-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="antecedent-retry-button"
              >
                Retry
              </button>
            </div>
          }
        }
      </div>
    </section>
  `,
})
export class AntecedentViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly antecedentStudy = inject(AntecedentStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);
  readonly rows = signal<OccurrenceRow[]>([]);
  readonly options = signal<string[]>([]);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  /** Per-occurrence free-text draft for the "Add" input. */
  private readonly drafts = signal<Record<number, string>>({});

  scrollStudyId = '';

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.load();
  }

  /** Load the scroll study, derive the worklist, and pre-fill from any saved antecedent study. */
  load(): void {
    this.state.set('loading');
    this.saved.set(false);
    this.saveError.set(false);
    this.scrollStudy.getScrollStudy(this.scrollStudyId).subscribe({
      next: (s) => {
        this.study.set(s);
        if (s.status === 'ready') {
          this.buildWorklist(s.scrollText);
          this.state.set('ready');
          this.loadSaved();
        } else if (s.status === 'failed') {
          this.state.set('failed');
        } else {
          // uploading | extracting
          this.state.set('preparing');
        }
      },
      error: (err: { status?: number }) => {
        this.state.set(err?.status === 404 ? 'failed' : 'error');
      },
    });
  }

  private buildWorklist(scrollText: string): void {
    const rows = parsePronounOccurrences(scrollText).map((occ) => ({
      occurrence: occ.occurrence,
      start: occ.start,
      word: occ.word,
      snippet: this.snippetAround(scrollText, occ.start, occ.token.length),
      antecedent: '',
    }));
    this.rows.set(rows);
    this.options.set(suggestAntecedents(scrollText));
    this.drafts.set({});
  }

  /** Fetch the saved study (if any) and pre-fill rows by occurrence. A 404 means "none yet". */
  private loadSaved(): void {
    this.antecedentStudy.get(this.scrollStudyId).subscribe({
      next: (saved) => {
        const byOccurrence = new Map(saved.assignments.map((a) => [a.occurrence, a.antecedent]));
        this.rows.update((rows) =>
          rows.map((row) => {
            const antecedent = byOccurrence.get(row.occurrence);
            // Ignore a saved assignment whose occurrence no longer resolves to a current row.
            return antecedent !== undefined ? { ...row, antecedent } : row;
          }),
        );
        // Seed options with saved antecedents so previously-typed values stay selectable.
        const savedValues = saved.assignments.map((a) => a.antecedent).filter((v) => v.length > 0);
        for (const value of savedValues) {
          this.mergeOption(value);
        }
      },
      error: () => {
        // No saved study (404) or a transient failure: the worksheet is still usable from the
        // parse, all rows start unassigned.
      },
    });
  }

  private snippetAround(text: string, start: number, length: number): string {
    const from = Math.max(0, start - SNIPPET_RADIUS);
    const to = Math.min(text.length, start + length + SNIPPET_RADIUS);
    const prefix = from > 0 ? '…' : '';
    const suffix = to < text.length ? '…' : '';
    return `${prefix}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${suffix}`;
  }

  draft(occurrence: number): string {
    return this.drafts()[occurrence] ?? '';
  }

  setDraft(occurrence: number, value: string): void {
    this.drafts.update((d) => ({ ...d, [occurrence]: value }));
  }

  /** Select or clear an antecedent for one occurrence; never touches another occurrence. */
  setAntecedent(occurrence: number, value: string): void {
    const trimmed = value.trim();
    this.rows.update((rows) =>
      rows.map((row) => (row.occurrence === occurrence ? { ...row, antecedent: trimmed } : row)),
    );
    this.saved.set(false);
  }

  /** Add the row's typed draft: trim, (whitespace-only clears), de-dup into options, set the row. */
  addAntecedent(occurrence: number): void {
    const trimmed = this.draft(occurrence).trim();
    if (trimmed.length === 0) {
      // All-whitespace entry clears the selection rather than adding a blank option.
      this.setAntecedent(occurrence, '');
    } else {
      this.mergeOption(trimmed);
      this.setAntecedent(occurrence, trimmed);
    }
    this.setDraft(occurrence, '');
  }

  /** Add a value to the shared options, case-insensitively de-duped (first-seen casing kept). */
  private mergeOption(value: string): void {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.options.update((opts) => {
      if (opts.some((o) => o.toLowerCase() === trimmed.toLowerCase())) {
        return opts;
      }
      return [...opts, trimmed].sort((a, b) => a.localeCompare(b));
    });
  }

  /** Save the non-empty assignments; keep selections editable on failure (retryable). */
  save(): void {
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    const assignments: AntecedentAssignment[] = this.rows()
      .filter((row) => row.antecedent.trim().length > 0)
      .map((row) => ({
        occurrence: row.occurrence,
        start: row.start,
        word: row.word,
        antecedent: row.antecedent.trim(),
      }));
    this.antecedentStudy.save(this.scrollStudyId, assignments).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(true);
      },
    });
  }

  failedMessage(): string {
    return this.study()?.failureReason || 'This scroll could not be found.';
  }
}
