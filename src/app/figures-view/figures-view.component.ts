import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { FiguresStudyService } from '../figures-study.service';
import { FiguresAssistService } from '../figures-assist.service';
import { FigureCandidate, FigureEntry } from '../models';
import { FIGURE_TYPES, FIGURE_TYPE_IDS, groupForType, nameForType } from '../figures-taxonomy';
import { FIGURE_GLOSSARY } from '../figures-glossary';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

/** A blank entry (default type: the first taxonomy id). */
function blankEntry(): FigureEntry {
  const first = FIGURE_TYPES[0];
  return {
    figureType: first.id,
    otherLabel: '',
    group: first.group,
    reference: '',
    text: '',
    interpretation: '',
    notes: '',
  };
}

@Component({
  selector: 'app-figures-view',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Figures study">
      <div class="container">
        @if (study(); as s) {
          <h2 class="title is-4" data-testid="figures-book">
            {{ s.bookName }} — Figures of Speech
          </h2>
        }

        @switch (state()) {
          @case ('loading') {
            <div class="has-text-centered py-5" aria-live="polite" aria-busy="true">
              <p>Loading…</p>
            </div>
          }
          @case ('ready') {
            <p class="mb-4">
              Identify the figures of speech and Hebrew-poetry parallelism in the book, and record
              what you judge each one means. Interpret literal language literally and figurative
              figuratively — but
              <em>if the first sense makes sense, don't look for another sense</em>; context
              decides, and symbolism illustrates rather than proves.
            </p>

            <!-- AI candidate scan (advisory, on demand) -->
            <div class="box" data-testid="figures-suggest">
              <h3 class="title is-5">Suggest candidates</h3>
              <p class="help mb-2">
                An optional AI pass over your scroll text surfaces passages that
                <em>may</em> contain a figure — a location and one type to consider. It never
                interprets the passage or adds entries; you decide what to keep.
              </p>
              <button
                class="button is-small"
                type="button"
                [class.is-loading]="suggesting()"
                [disabled]="suggesting()"
                (click)="suggest()"
                data-testid="suggest-candidates"
              >
                Suggest candidates
              </button>
              <div aria-live="polite">
                @if (suggestError()) {
                  <p class="has-text-danger mt-2" data-testid="suggest-error">
                    {{ suggestError() }}
                  </p>
                }
                @if (candidates().length > 0) {
                  <table class="table is-fullwidth mt-3" aria-label="Candidate passages">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Type to consider</th>
                        <th>Why look here</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of candidates(); track $index) {
                        <tr data-testid="candidate-row">
                          <td>{{ c.reference }}</td>
                          <td>{{ typeName(c.suggestedType) }}</td>
                          <td>{{ c.reason }}</td>
                          <td class="is-flex" style="gap: 0.25rem">
                            <button
                              class="button is-small is-link is-light"
                              type="button"
                              (click)="acceptCandidate($index)"
                              data-testid="candidate-accept"
                            >
                              Add as entry
                            </button>
                            <button
                              class="button is-small is-outlined"
                              type="button"
                              (click)="dismissCandidate($index)"
                              data-testid="candidate-dismiss"
                            >
                              Dismiss
                            </button>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </div>

            <!-- Figure entries -->
            <div class="box" data-testid="figures-entries">
              <h3 class="title is-5">Figures &amp; parallelism</h3>
              @if (entries().length === 0) {
                <div role="status" data-testid="figures-empty" class="mb-3">
                  No figures recorded yet. Add one below, or use “Suggest candidates”.
                </div>
              }
              @for (e of entries(); track $index) {
                <div class="box p-3 mb-2" data-testid="figure-entry-row">
                  <div class="field is-grouped mb-2">
                    <div class="control">
                      <div class="select is-small">
                        <select
                          [ngModel]="e.figureType"
                          (ngModelChange)="setType($index, $event)"
                          [attr.aria-label]="'Entry ' + ($index + 1) + ' figure type'"
                          data-testid="figuretype-select"
                        >
                          <optgroup label="Parallelism">
                            @for (t of parallelismTypes; track t.id) {
                              <option [value]="t.id">{{ t.name }}</option>
                            }
                          </optgroup>
                          <optgroup label="Figures of speech">
                            @for (t of figureTypes; track t.id) {
                              <option [value]="t.id">{{ t.name }}</option>
                            }
                          </optgroup>
                          <option value="other">Other…</option>
                        </select>
                      </div>
                    </div>
                    <div class="control is-expanded">
                      <button
                        class="button is-small is-text"
                        type="button"
                        (click)="toggleExplain($index)"
                        [attr.aria-expanded]="explainOpen() === $index"
                        data-testid="type-explain"
                      >
                        What is this?
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small is-danger is-outlined"
                        type="button"
                        (click)="removeEntry($index)"
                        [attr.aria-label]="'Remove entry ' + ($index + 1)"
                        data-testid="figure-entry-remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  @if (explainOpen() === $index) {
                    <div class="notification is-info is-light py-2" data-testid="glossary-text">
                      {{ glossaryFor(e.figureType) }}
                    </div>
                  }

                  @if (e.figureType === 'other') {
                    <div class="field is-grouped mb-2">
                      <div class="control is-expanded">
                        <input
                          class="input is-small"
                          type="text"
                          maxlength="100"
                          placeholder="Name this figure"
                          [ngModel]="e.otherLabel"
                          (ngModelChange)="setOtherLabel($index, $event)"
                          [attr.aria-label]="'Entry ' + ($index + 1) + ' other label'"
                          data-testid="figure-other-label"
                        />
                      </div>
                      <div class="control">
                        <div class="select is-small">
                          <select
                            [ngModel]="e.group"
                            (ngModelChange)="setGroup($index, $event)"
                            [attr.aria-label]="'Entry ' + ($index + 1) + ' group'"
                            data-testid="figure-other-group"
                          >
                            <option value="figure">Figure of speech</option>
                            <option value="parallelism">Parallelism</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  }

                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'ref-' + $index"
                      >Reference</label
                    >
                    <input
                      [id]="'ref-' + $index"
                      class="input is-small"
                      type="text"
                      maxlength="200"
                      placeholder="e.g. 2:6-11 or “the opening hymn” (location only)"
                      [ngModel]="e.reference"
                      (ngModelChange)="setField($index, 'reference', $event)"
                      data-testid="figure-reference"
                    />
                  </div>
                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'text-' + $index">
                      Your transcription / paraphrase (optional)
                    </label>
                    <textarea
                      [id]="'text-' + $index"
                      class="textarea is-small"
                      rows="2"
                      maxlength="2000"
                      placeholder="The passage in your own words (optional — you may cite the location only)"
                      [ngModel]="e.text"
                      (ngModelChange)="setField($index, 'text', $event)"
                      data-testid="figure-text"
                    ></textarea>
                  </div>
                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'interp-' + $index">
                      What it means
                    </label>
                    <textarea
                      [id]="'interp-' + $index"
                      class="textarea is-small"
                      rows="2"
                      maxlength="2000"
                      placeholder="Your interpretation of the figure"
                      [ngModel]="e.interpretation"
                      (ngModelChange)="setField($index, 'interpretation', $event)"
                      data-testid="figure-interpretation"
                    ></textarea>
                  </div>
                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'notes-' + $index">Notes</label>
                    <textarea
                      [id]="'notes-' + $index"
                      class="textarea is-small"
                      rows="2"
                      maxlength="1000"
                      [ngModel]="e.notes"
                      (ngModelChange)="setField($index, 'notes', $event)"
                      data-testid="figure-notes"
                    ></textarea>
                  </div>

                  <!-- Check my tag (AI, on demand; never auto-applies) -->
                  <div class="field">
                    <button
                      class="button is-small is-link is-light"
                      type="button"
                      [class.is-loading]="checking() === $index"
                      [disabled]="checking() !== null"
                      (click)="check($index)"
                      data-testid="check-tag"
                    >
                      Check this tag
                    </button>
                    @if (checkIndex() === $index && checkResult()) {
                      <div
                        class="notification is-light py-2 mt-2"
                        aria-live="polite"
                        data-testid="check-result"
                      >
                        {{ checkResult() }}
                      </div>
                    }
                  </div>
                </div>
              }
              <button
                class="button is-small"
                type="button"
                (click)="addEntry()"
                data-testid="figure-entry-add"
              >
                Add figure
              </button>
            </div>

            <!-- Save -->
            <div class="field">
              <button
                class="button is-primary"
                type="button"
                [class.is-loading]="saving()"
                [disabled]="saving()"
                (click)="save()"
                data-testid="figures-save"
              >
                Save
              </button>
            </div>
            <div aria-live="polite">
              @if (saved()) {
                <p class="has-text-success" data-testid="figures-saved">Saved.</p>
              }
              @if (saveError()) {
                <p class="has-text-danger" data-testid="figures-save-error">
                  Could not save. Your work is still here — try again.
                </p>
              }
            </div>
          }
          @case ('preparing') {
            <div
              class="notification is-info"
              role="status"
              aria-live="polite"
              data-testid="figures-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="figures-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="figures-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="figures-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="figures-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="figures-retry-button"
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
export class FiguresViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly figuresStudy = inject(FiguresStudyService);
  private readonly assist = inject(FiguresAssistService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);
  private readonly scrollText = signal('');

  readonly entries = signal<FigureEntry[]>([]);

  // Taxonomy, split for the two optgroups.
  readonly parallelismTypes = FIGURE_TYPES.filter((t) => t.group === 'parallelism');
  readonly figureTypes = FIGURE_TYPES.filter((t) => t.group === 'figure');

  // Assist state (transient; never persisted)
  readonly candidates = signal<FigureCandidate[]>([]);
  readonly suggesting = signal(false);
  readonly suggestError = signal('');
  readonly checking = signal<number | null>(null);
  readonly checkIndex = signal<number | null>(null);
  readonly checkResult = signal('');
  readonly explainOpen = signal<number | null>(null);

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  scrollStudyId = '';

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.load();
  }

  load(): void {
    this.state.set('loading');
    this.saved.set(false);
    this.saveError.set(false);
    this.scrollStudy.getScrollStudy(this.scrollStudyId).subscribe({
      next: (s) => {
        this.study.set(s);
        if (s.status === 'ready') {
          this.scrollText.set(s.scrollText);
          this.state.set('ready');
          this.loadSaved();
        } else if (s.status === 'failed') {
          this.state.set('failed');
        } else {
          this.state.set('preparing');
        }
      },
      error: (err: { status?: number }) => {
        this.state.set(err?.status === 404 ? 'failed' : 'error');
      },
    });
  }

  /** Fetch the saved study (if any). A 404 means "none yet" → empty editable worksheet. */
  private loadSaved(): void {
    this.figuresStudy.get(this.scrollStudyId).subscribe({
      next: (saved) => {
        this.entries.set(saved.entries);
      },
      error: () => {
        // 404 (none yet) or transient: leave the empty worksheet in place.
      },
    });
  }

  failedMessage(): string {
    const s = this.study();
    if (s?.status === 'failed') {
      return s.failureReason || 'This scroll could not be prepared.';
    }
    return 'This scroll could not be found.';
  }

  typeName(id: string): string {
    return nameForType(id);
  }

  glossaryFor(id: string): string {
    return FIGURE_GLOSSARY[id] ?? 'No definition available for this type.';
  }

  // --- entries ---

  addEntry(): void {
    this.entries.update((e) => [...e, blankEntry()]);
  }

  removeEntry(index: number): void {
    this.entries.update((e) => e.filter((_, i) => i !== index));
    if (this.checkIndex() === index) {
      this.checkIndex.set(null);
      this.checkResult.set('');
    }
  }

  setType(index: number, figureType: string): void {
    // Recompute group from a known type; 'other' keeps its current group (student picks it).
    const g = groupForType(figureType);
    this.entries.update((e) =>
      e.map((entry, i) =>
        i === index
          ? {
              ...entry,
              figureType,
              group: g ?? entry.group,
              otherLabel: figureType === 'other' ? entry.otherLabel : '',
            }
          : entry,
      ),
    );
  }

  setOtherLabel(index: number, otherLabel: string): void {
    this.entries.update((e) =>
      e.map((entry, i) => (i === index ? { ...entry, otherLabel } : entry)),
    );
  }

  setGroup(index: number, group: 'parallelism' | 'figure'): void {
    this.entries.update((e) => e.map((entry, i) => (i === index ? { ...entry, group } : entry)));
  }

  setField(
    index: number,
    field: 'reference' | 'text' | 'interpretation' | 'notes',
    value: string,
  ): void {
    this.entries.update((e) =>
      e.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }

  toggleExplain(index: number): void {
    this.explainOpen.update((cur) => (cur === index ? null : index));
  }

  // --- assist: suggest ---

  suggest(): void {
    this.suggesting.set(true);
    this.suggestError.set('');
    this.candidates.set([]);
    const types = FIGURE_TYPES.map((t) => t.id);
    this.assist.suggest(this.scrollText(), '', types).subscribe({
      next: (res) => {
        this.suggesting.set(false);
        if (res.degraded) {
          this.suggestError.set(res.message ?? 'The AI assist is unavailable right now.');
          return;
        }
        this.candidates.set(res.candidates ?? []);
      },
      error: () => {
        this.suggesting.set(false);
        this.suggestError.set('The AI assist is unavailable right now. Please try again.');
      },
    });
  }

  /** Turn a candidate into an editable entry, pre-filling reference + the suggested type. */
  acceptCandidate(index: number): void {
    const c = this.candidates()[index];
    if (!c) return;
    const known = FIGURE_TYPE_IDS.has(c.suggestedType);
    const figureType = known ? c.suggestedType : 'other';
    const entry: FigureEntry = {
      ...blankEntry(),
      figureType,
      group: known ? (groupForType(c.suggestedType) ?? 'figure') : 'figure',
      reference: c.reference,
    };
    this.entries.update((e) => [...e, entry]);
    this.dismissCandidate(index);
  }

  dismissCandidate(index: number): void {
    this.candidates.update((c) => c.filter((_, i) => i !== index));
  }

  // --- assist: check ---

  check(index: number): void {
    const entry = this.entries()[index];
    if (!entry) return;
    this.checking.set(index);
    this.checkIndex.set(index);
    this.checkResult.set('');
    const label = entry.figureType === 'other' ? entry.otherLabel : nameForType(entry.figureType);
    this.assist.check(label, entry.reference, entry.text).subscribe({
      next: (res) => {
        this.checking.set(null);
        if (res.degraded) {
          this.checkResult.set(res.message ?? 'The AI assist is unavailable right now.');
          return;
        }
        this.checkResult.set(res.advice);
      },
      error: () => {
        this.checking.set(null);
        this.checkResult.set('The AI assist is unavailable right now. Please try again.');
      },
    });
  }

  // --- save ---

  save(): void {
    // Drop entries with an empty reference before persisting.
    const entries = this.entries().filter((e) => e.reference.trim().length > 0);
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.figuresStudy.save(this.scrollStudyId, { entries }).subscribe({
      next: (savedStudy) => {
        this.saving.set(false);
        this.saved.set(true);
        this.entries.set(savedStudy.entries);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(true);
      },
    });
  }
}
