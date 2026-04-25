import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { StrongsStudyResult, CrossReference } from '../models';
import { TruncatePipe } from '../truncate.pipe';
import { EnglishDictionaryResult } from '../english-definition.service';

export type AiSummaryState = 'idle' | 'loading' | 'loaded' | 'error';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface CrossReferenceNoteChange {
  index: number;
  notes: string;
}

export interface StrongsNumberSubmitted {
  strongsNumber: string;
}

const STRONGS_PATTERN = /^[GH]\d+$/;

@Component({
  selector: 'app-study-worksheet',
  imports: [ReactiveFormsModule, TruncatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Word study worksheet">
      <div class="container">
        <div class="columns">
          <div class="column is-8">
            <h2 class="title is-4">Word Study: {{ word() }}</h2>

            <!-- Progress bar -->
            <nav aria-label="Study progress" class="mb-5">
              <ul class="steps" role="list">
                @for (step of steps; track step.number) {
                  <li
                    class="steps-segment"
                    [class.is-active]="step.number === activeStep()"
                    [class.is-completed]="step.number < activeStep() || (viewAll() && step.number <= maxStepReached())"
                    [class.is-future]="step.number > maxStepReached() && !viewAll()"
                    role="listitem"
                  >
                    @if (step.number <= maxStepReached() || viewAll()) {
                      <button
                        class="steps-marker"
                        [class.is-clickable]="step.number !== activeStep()"
                        (click)="toggleStep(step.number)"
                        [attr.aria-label]="'Toggle step ' + step.number + ': ' + step.label"
                      >{{ step.number }}</button>
                    } @else {
                      <span class="steps-marker">{{ step.number }}</span>
                    }
                    <span class="steps-content">
                      <p class="is-size-7">{{ step.label }}</p>
                    </span>
                  </li>
                }
              </ul>
            </nav>

            <!-- Step 1: English Definition -->
            @if (maxStepReached() >= 1 || viewAll()) {
              <article class="box mb-4 step-card" [class.is-collapsed]="!isExpanded(1)">
                <header class="step-header" (click)="toggleStep(1)" (keydown.enter)="toggleStep(1)" tabindex="0" role="button" [attr.aria-expanded]="isExpanded(1)">
                  <h3 class="subtitle is-5 mb-0">
                    <span class="tag is-info is-light mr-2">1</span>
                    English Definition
                    @if (!isExpanded(1) && englishDefinition()) {
                      <span class="has-text-grey is-size-7 ml-2">— {{ englishDefSummary() | truncate }}</span>
                    }
                  </h3>
                  <span class="icon chevron">
                    <span>{{ isExpanded(1) ? '▾' : '▸' }}</span>
                  </span>
                </header>
                @if (isExpanded(1)) {
                  <div class="step-body mt-3">
                    @if (englishDefLoading()) {
                      <p class="has-text-grey" aria-busy="true">Looking up definition…</p>
                    } @else if (englishDefinition(); as dictResult) {
                      <div class="content" data-testid="english-definition">
                        <h4 class="is-size-5 mb-1">{{ dictResult.word }}</h4>
                        @if (dictResult.phonetic) {
                          <p class="has-text-grey is-size-7 mb-3">{{ dictResult.phonetic }}</p>
                        }
                        @for (meaning of dictResult.meanings; track meaning.partOfSpeech) {
                          <div class="mb-4">
                            <p class="has-text-weight-semibold is-italic is-size-7 mb-1">{{ meaning.partOfSpeech }}</p>
                            <ol class="ml-4 is-size-7">
                              @for (def of meaning.definitions; track def.definition) {
                                <li class="mb-1">
                                  {{ def.definition }}
                                  @if (def.example) {
                                    <span class="has-text-grey is-italic"> — "{{ def.example }}"</span>
                                  }
                                </li>
                              }
                            </ol>
                          </div>
                        }
                      </div>
                      <p class="is-size-7 has-text-grey">
                        Source: <a href="https://dictionaryapi.dev/" target="_blank" rel="noopener noreferrer">Free Dictionary API</a>
                      </p>
                    } @else {
                      <p class="has-text-grey">Definition not available.</p>
                    }
                    <div class="field mt-3">
                      <label class="label is-small" for="step1-notes">Your notes</label>
                      <div class="control">
                        <textarea class="textarea is-small" id="step1-notes" [value]="step1Notes()" (input)="onStep1NotesChange($event)" placeholder="What stands out about this word's English meaning?" rows="2" data-testid="step1-notes"></textarea>
                      </div>
                    </div>
                    @if (!strongsData() && !englishDefLoading()) {
                      <button class="button is-primary is-small mt-3" (click)="advanceTo(2)" data-testid="step1-next">Next: Strong's Lookup</button>
                    }
                  </div>
                }
              </article>
            }

            <!-- Step 2: Strong's Concordance -->
            @if (maxStepReached() >= 2 || viewAll()) {
              <article class="box mb-4 step-card" [class.is-collapsed]="!isExpanded(2)">
                <header class="step-header" (click)="toggleStep(2)" (keydown.enter)="toggleStep(2)" tabindex="0" role="button" [attr.aria-expanded]="isExpanded(2)">
                  <h3 class="subtitle is-5 mb-0">
                    <span class="tag is-info is-light mr-2">2</span>
                    Strong's Concordance
                    @if (!isExpanded(2) && strongsData()) {
                      <span class="has-text-grey is-size-7 ml-2">— {{ strongsData()!.strongsNumber }} · {{ strongsData()!.originalWord }} ({{ strongsData()!.transliteration }})</span>
                    }
                  </h3>
                  <span class="icon chevron"><span>{{ isExpanded(2) ? '▾' : '▸' }}</span></span>
                </header>
                @if (isExpanded(2)) {
                  <div class="step-body mt-3">
                    @if (!strongsData()) {
                      <form [formGroup]="strongsForm" (ngSubmit)="onStrongsSubmit()" class="mb-3">
                        <div class="field has-addons">
                          <div class="control is-expanded">
                            <input id="strongs-input" class="input" type="text" formControlName="strongsNumber" placeholder="e.g. G25 or H157" [class.is-danger]="showStrongsError()" aria-required="true" [attr.aria-invalid]="showStrongsError()" />
                          </div>
                          <div class="control">
                            <button type="submit" class="button is-info" [class.is-loading]="strongsLoading()" [disabled]="strongsForm.invalid || strongsLoading()" data-testid="strongs-submit">Look Up</button>
                          </div>
                        </div>
                        @if (showStrongsError()) {
                          <p id="strongs-error" class="help is-danger" role="alert">
                            @if (strongsForm.controls.strongsNumber.hasError('required')) {
                              Please enter a Strong's number.
                            } @else {
                              Invalid format. Use G or H followed by digits (e.g. G25, H157).
                            }
                          </p>
                        }
                      </form>
                      @if (strongsError()) {
                        <div class="notification is-danger is-light" role="alert">{{ strongsError() }}</div>
                      }
                    } @else {
                      <dl aria-label="Strong's concordance data">
                        @for (field of strongsDefFields(); track field.testId) {
                          <div class="columns is-mobile mb-1" [attr.data-testid]="field.testId">
                            <dt class="column is-one-third has-text-weight-semibold is-size-7">{{ field.label }}</dt>
                            <dd class="column is-size-7" style="margin-left:0">{{ field.value }}</dd>
                          </div>
                        }
                      </dl>
                      <div class="field mt-3">
                        <label class="label is-small" for="step2-notes">Your notes</label>
                        <div class="control">
                          <textarea class="textarea is-small" id="step2-notes" [value]="step2Notes()" (input)="onStep2NotesChange($event)" placeholder="What do you notice about the original word?" rows="2" data-testid="step2-notes"></textarea>
                        </div>
                      </div>
                    }
                  </div>
                }
              </article>
            }

            <!-- Step 3: Lexicon Entry -->
            @if ((maxStepReached() >= 3 && strongsData()) || viewAll()) {
              <article class="box mb-4 step-card" [class.is-collapsed]="!isExpanded(3)">
                <header class="step-header" (click)="toggleStep(3)" (keydown.enter)="toggleStep(3)" tabindex="0" role="button" [attr.aria-expanded]="isExpanded(3)">
                  <h3 class="subtitle is-5 mb-0">
                    <span class="tag is-info is-light mr-2">3</span>
                    Lexicon Entry
                    @if (!isExpanded(3) && strongsData()) {
                      <span class="has-text-grey is-size-7 ml-2">— {{ strongsData()!.lexiconEntry | truncate }}</span>
                    }
                  </h3>
                  <span class="icon chevron"><span>{{ isExpanded(3) ? '▾' : '▸' }}</span></span>
                </header>
                @if (isExpanded(3)) {
                  <div class="step-body mt-3">
                    <div class="content" data-testid="strongs-lexicon-entry">
                      <p>{{ strongsData()?.lexiconEntry }}</p>
                    </div>
                    <div class="field mt-3">
                      <label class="label is-small" for="step3-notes">Your notes</label>
                      <div class="control">
                        <textarea class="textarea is-small" id="step3-notes" [value]="step3Notes()" (input)="onStep3NotesChange($event)" placeholder="What additional insight does the lexicon provide?" rows="2" data-testid="step3-notes"></textarea>
                      </div>
                    </div>
                  </div>
                }
              </article>
            }

            <!-- Step 4: Cross-References -->
            @if ((maxStepReached() >= 4 && crossReferences()) || viewAll()) {
              <article class="box mb-4 step-card" [class.is-collapsed]="!isExpanded(4)">
                <header class="step-header" (click)="toggleStep(4)" (keydown.enter)="toggleStep(4)" tabindex="0" role="button" [attr.aria-expanded]="isExpanded(4)">
                  <h3 class="subtitle is-5 mb-0">
                    <span class="tag is-info is-light mr-2">4</span>
                    Cross-References
                    @if (!isExpanded(4) && crossReferences()) {
                      <span class="has-text-grey is-size-7 ml-2">— {{ crossReferences()!.length }} verse(s)</span>
                    }
                  </h3>
                  <span class="icon chevron"><span>{{ isExpanded(4) ? '▾' : '▸' }}</span></span>
                </header>
                @if (isExpanded(4)) {
                  <div class="step-body mt-3">
                    @if (crossReferences(); as refs) {
                      @if (refs.length === 0) {
                        <p class="has-text-grey" data-testid="no-cross-refs">No cross-references found for this Strong's number.</p>
                      } @else {
                        <p class="has-text-grey is-size-7 mb-3">{{ refs.length }} cross-reference(s) found. Click a verse to add notes.</p>
                        <div class="cross-ref-list">
                          @for (ref of refs; track ref.reference; let i = $index) {
                            <div class="cross-ref-item" [attr.data-testid]="'cross-ref-' + i">
                              <div
                                class="cross-ref-header"
                                (click)="toggleCrossRef(i)"
                                (keydown.enter)="toggleCrossRef(i)"
                                tabindex="0"
                                role="button"
                                [attr.aria-expanded]="isCrossRefExpanded(i)"
                              >
                                <span class="cross-ref-num">{{ i + 1 }}</span>
                                <strong class="is-size-7" data-testid="cross-ref-reference">{{ ref.reference }}</strong>
                                @if (ref.notes) {
                                  <span class="tag is-info is-light is-small ml-2">noted</span>
                                }
                                <span class="chevron-sm ml-auto">{{ isCrossRefExpanded(i) ? '▾' : '▸' }}</span>
                              </div>
                              @if (isCrossRefExpanded(i)) {
                                <div class="cross-ref-body mt-2">
                                  <textarea
                                    class="textarea is-small"
                                    [attr.aria-label]="'Notes for ' + ref.reference"
                                    [value]="ref.notes"
                                    (input)="onCrossRefNoteChange(i, $event)"
                                    placeholder="What do you observe about how this word is used here?"
                                    rows="2"
                                    [attr.data-testid]="'cross-ref-notes-' + i"
                                  ></textarea>
                                </div>
                              }
                            </div>
                          }
                        </div>
                      }
                    }
                  </div>
                }
              </article>
            }

            <!-- Step 5: AI Summary -->
            @if ((maxStepReached() >= 5) || viewAll()) {
              <article class="box mb-4 step-card" [class.is-collapsed]="!isExpanded(5)">
                <header class="step-header" (click)="toggleStep(5)" (keydown.enter)="toggleStep(5)" tabindex="0" role="button" [attr.aria-expanded]="isExpanded(5)">
                  <h3 class="subtitle is-5 mb-0">
                    <span class="tag is-info is-light mr-2">5</span>
                    AI Summary
                    @if (!isExpanded(5) && aiSummaryState() === 'loaded') {
                      <span class="tag is-info is-light is-small ml-2">generated</span>
                    }
                  </h3>
                  <span class="icon chevron"><span>{{ isExpanded(5) ? '▾' : '▸' }}</span></span>
                </header>
                @if (isExpanded(5)) {
                  <div class="step-body mt-3">
                    @if (aiSummaryState() === 'loading') {
                      <div class="has-text-centered py-3" aria-live="polite" aria-busy="true" data-testid="ai-summary-loading">
                        <button class="button is-info is-loading is-small" disabled>Generating…</button>
                      </div>
                    } @else if (aiSummaryState() === 'error') {
                      <div class="notification is-warning is-light" role="alert" data-testid="ai-summary-error">
                        <p class="is-size-7">AI summary unavailable. Please try again later.</p>
                      </div>
                      <button class="button is-info is-outlined is-small" (click)="onGenerateAiSummary()" data-testid="ai-summary-retry-button">Retry</button>
                    } @else if (aiSummaryState() === 'loaded' && aiSummary()) {
                      <div class="content" data-testid="ai-summary-content">
                        <blockquote class="is-size-7">{{ aiSummary() }}</blockquote>
                      </div>
                      <button class="button is-info is-outlined is-small mt-2" (click)="onGenerateAiSummary()" data-testid="ai-summary-regenerate-button">Regenerate</button>
                    } @else {
                      <button class="button is-info is-small" (click)="onGenerateAiSummary()" [disabled]="!strongsData()" data-testid="ai-summary-button">Generate AI Summary</button>
                    }
                  </div>
                }
              </article>
            }

            <!-- Save footer is outside the columns -->
          </div>

          <!-- General Notes sidebar -->
          <div class="column is-4">
            <div class="box sticky-sidebar">
              <h3 class="subtitle is-6">General Notes</h3>
              <p class="has-text-grey is-size-7 mb-3">Jot down observations at any time.</p>
              <textarea
                class="textarea"
                aria-label="General notes"
                [value]="notes() ?? ''"
                (input)="onNotesChange($event)"
                placeholder="Your overall insights…"
                rows="12"
                data-testid="general-notes"
              ></textarea>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Sticky save footer -->
    <div class="save-footer" role="status" aria-live="polite">
      @if (saveState() === 'saved') {
        <span class="tag is-success is-light" data-testid="save-success">Saved ✓</span>
      }
      @if (saveState() === 'error') {
        <span class="tag is-danger is-light" data-testid="save-error">Save failed — try again</span>
      }
      <button
        class="button is-primary"
        [class.is-loading]="saveState() === 'saving'"
        [disabled]="saveState() === 'saving'"
        (click)="onSaveStudy()"
        data-testid="save-button"
      >{{ saveButtonLabel() }}</button>
    </div>
  `,
  styles: `
    .steps { display: flex; list-style: none; padding: 0; margin: 0; gap: 0.15rem; }
    .steps-segment { display: flex; align-items: center; gap: 0.4rem; flex: 1; padding: 0.4rem; border-radius: 4px; opacity: 0.4; transition: opacity 0.15s; }
    .steps-segment.is-active { background-color: var(--bulma-info-light); opacity: 1; }
    .steps-segment.is-completed { opacity: 1; }
    .steps-marker { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background-color: var(--bulma-border); font-weight: 600; font-size: 0.75rem; flex-shrink: 0; border: none; color: var(--bulma-text); }
    .steps-marker.is-clickable { cursor: pointer; background-color: var(--bulma-info); color: var(--bulma-info-invert, #fff); }
    .steps-marker.is-clickable:hover { opacity: 0.85; }
    .steps-segment.is-active .steps-marker { background-color: var(--bulma-primary); color: var(--bulma-primary-invert, #fff); }

    .step-card { transition: all 0.15s; }
    .step-card.is-collapsed { padding: 0.75rem 1.25rem; }
    .step-header { display: flex; align-items: center; cursor: pointer; user-select: none; }
    .step-header:hover { opacity: 0.8; }
    .chevron { margin-left: auto; font-size: 0.85rem; color: var(--bulma-text-weak); }

    .cross-ref-list { border: 1px solid var(--bulma-border); border-radius: 4px; }
    .cross-ref-item { border-bottom: 1px solid var(--bulma-border); padding: 0.5rem 0.75rem; }
    .cross-ref-item:last-child { border-bottom: none; }
    .cross-ref-header { display: flex; align-items: center; cursor: pointer; gap: 0.5rem; }
    .cross-ref-header:hover { background-color: var(--bulma-scheme-main-bis); border-radius: 4px; }
    .cross-ref-num { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; border-radius: 50%; background: var(--bulma-border); font-size: 0.65rem; font-weight: 600; flex-shrink: 0; }
    .chevron-sm { font-size: 0.75rem; color: var(--bulma-text-weak); }
    .cross-ref-body { padding-left: 1.75rem; }

    .sticky-sidebar { position: sticky; top: 1rem; }
  `,
})
export class StudyWorksheetComponent {
  readonly word = input<string>('');
  readonly strongsNumber = input<string | null>(null);
  readonly strongsData = input<StrongsStudyResult | null>(null);
  readonly crossReferences = input<CrossReference[] | null>(null);
  readonly englishDefinition = input<EnglishDictionaryResult | null>(null);
  readonly englishDefLoading = input<boolean>(false);
  readonly strongsLoading = input<boolean>(false);
  readonly strongsError = input<string | null>(null);
  readonly notes = input<string | null>(null);
  readonly aiSummary = input<string | null>(null);
  readonly aiSummaryState = input<AiSummaryState>('idle');
  readonly saveState = input<SaveState>('idle');
  readonly studyId = input<string | null>(null);
  readonly viewAll = input<boolean>(false);
  readonly step1Notes = input<string>('');
  readonly step2Notes = input<string>('');
  readonly step3Notes = input<string>('');

  readonly crossReferenceNoteChange = output<CrossReferenceNoteChange>();
  readonly notesChange = output<string>();
  readonly generateAiSummary = output<void>();
  readonly saveStudy = output<void>();
  readonly strongsNumberSubmitted = output<StrongsNumberSubmitted>();
  readonly step1NotesChanged = output<string>();
  readonly step2NotesChanged = output<string>();
  readonly step3NotesChanged = output<string>();

  readonly activeStep = signal(1);
  readonly expandedSteps = signal<Set<number>>(new Set([1]));
  readonly expandedCrossRefs = signal<Set<number>>(new Set());

  /** Computed: the highest step that has data available. */
  readonly maxStepReached = computed(() => {
    if (this.viewAll()) return 5;
    if (this.crossReferences()) return 5;
    if (this.strongsData()) return 4;
    if (this.englishDefinition() || this.englishDefLoading()) return 2;
    return 1;
  });

  private readonly autoExpandEffect = effect(() => {
    const max = this.maxStepReached();
    const all = this.viewAll();
    if (all) {
      this.expandedSteps.set(new Set([1, 2, 3, 4, 5]));
      this.activeStep.set(1);
    } else {
      this.expandedSteps.update((set) => {
        const next = new Set(set);
        next.add(max);
        return next;
      });
      this.activeStep.set(max);
    }
  });

  readonly strongsForm = new FormGroup({
    strongsNumber: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(STRONGS_PATTERN)],
    }),
  });

  readonly steps = [
    { number: 1, label: 'Definition' },
    { number: 2, label: "Strong's" },
    { number: 3, label: 'Lexicon' },
    { number: 4, label: 'Cross-Refs' },
    { number: 5, label: 'AI Summary' },
  ];

  readonly saveButtonLabel = computed(() => this.studyId() ? 'Update Study' : 'Save Study');

  readonly englishDefSummary = computed(() => {
    const result = this.englishDefinition();
    if (!result || result.meanings.length === 0) return '';
    const first = result.meanings[0];
    return `(${first.partOfSpeech}) ${first.definitions[0]?.definition ?? ''}`;
  });

  readonly strongsDefFields = computed(() => {
    const data = this.strongsData();
    if (!data) return [];
    return [
      { label: "Strong's #", value: data.strongsNumber, testId: 'strongs-number' },
      { label: 'Definition', value: data.definition, testId: 'strongs-definition' },
      { label: 'Original Word', value: data.originalWord, testId: 'strongs-original-word' },
      { label: 'Transliteration', value: data.transliteration, testId: 'strongs-transliteration' },
    ];
  });

  isExpanded(step: number): boolean {
    return this.expandedSteps().has(step);
  }

  isCrossRefExpanded(index: number): boolean {
    return this.expandedCrossRefs().has(index);
  }

  toggleStep(step: number): void {
    if (step > this.maxStepReached() && !this.viewAll()) return;
    this.activeStep.set(step);
    this.expandedSteps.update((set) => {
      const next = new Set(set);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  }

  advanceTo(step: number): void {
    this.activeStep.set(step);
    this.expandedSteps.update((set) => {
      const next = new Set(set);
      next.add(step);
      return next;
    });
  }

  toggleCrossRef(index: number): void {
    this.expandedCrossRefs.update((set) => {
      const next = new Set(set);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  showStrongsError(): boolean {
    const ctrl = this.strongsForm.controls.strongsNumber;
    return ctrl.invalid && (ctrl.dirty || ctrl.touched);
  }

  onStrongsSubmit(): void {
    if (this.strongsForm.invalid) {
      this.strongsForm.markAllAsTouched();
      return;
    }
    this.strongsNumberSubmitted.emit({ strongsNumber: this.strongsForm.getRawValue().strongsNumber });
  }

  onCrossRefNoteChange(index: number, event: Event): void {
    this.crossReferenceNoteChange.emit({ index, notes: (event.target as HTMLTextAreaElement).value });
  }

  onNotesChange(event: Event): void {
    this.notesChange.emit((event.target as HTMLTextAreaElement).value);
  }

  onStep1NotesChange(event: Event): void { this.step1NotesChanged.emit((event.target as HTMLTextAreaElement).value); }
  onStep2NotesChange(event: Event): void { this.step2NotesChanged.emit((event.target as HTMLTextAreaElement).value); }
  onStep3NotesChange(event: Event): void { this.step3NotesChanged.emit((event.target as HTMLTextAreaElement).value); }

  onGenerateAiSummary(): void { this.generateAiSummary.emit(); }
  onSaveStudy(): void { this.saveStudy.emit(); }
}
