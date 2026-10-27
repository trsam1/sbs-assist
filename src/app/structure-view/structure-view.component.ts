import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { StructureStudyService } from '../structure-study.service';
import { StructureElement, StructureMarker, StructureSection, SecondaryGenre } from '../models';
import { BIBLICAL_GENRES } from '../structure-genres';
import { wordFrequency, suggestMarkers, type MarkerCandidate } from '../structure-analyze';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

/** The fixed marker kinds offered by the add-marker control. */
const MARKER_KINDS: readonly StructureMarker['kind'][] = [
  'transition',
  'direct-address',
  'declarative',
  'command',
  'other',
];

/** How many frequency rows to show before "show more". */
const FREQUENCY_PAGE = 25;

@Component({
  selector: 'app-structure-view',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Structure study">
      <div class="container">
        @if (study(); as s) {
          <h2 class="title is-4" data-testid="structure-book">{{ s.bookName }} — Structure</h2>
        }

        @switch (state()) {
          @case ('loading') {
            <div class="has-text-centered py-5" aria-live="polite" aria-busy="true">
              <p>Loading…</p>
            </div>
          }
          @case ('ready') {
            <p class="mb-4">
              Analyze the structure of the book: spot its focus words, mark its structural signals,
              name its genre and tone, and divide it into sections. Software surfaces candidates —
              you make the structural calls.
            </p>

            <!-- Repeated-word frequency -->
            <div class="box" data-testid="structure-frequency">
              <h3 class="title is-5">Focus words (repeated-word frequency)</h3>
              <label class="checkbox mb-3" data-testid="stopword-toggle">
                <input
                  type="checkbox"
                  [ngModel]="stopWords()"
                  (ngModelChange)="setStopWords($event)"
                  [attr.aria-pressed]="stopWords()"
                />
                Hide common words (articles, prepositions, pronouns)
              </label>
              @if (frequency().length === 0) {
                <div role="status" data-testid="structure-empty">
                  No words found in this scroll.
                </div>
              } @else {
                <table class="table is-striped is-fullwidth" aria-label="Repeated words and counts">
                  <thead>
                    <tr>
                      <th>Word</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of visibleFrequency(); track row.word) {
                      <tr data-testid="frequency-row">
                        <td data-testid="frequency-word">{{ row.word }}</td>
                        <td data-testid="frequency-count">{{ row.count }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                @if (frequency().length > visibleCount()) {
                  <button
                    class="button is-small"
                    type="button"
                    (click)="showMore()"
                    data-testid="frequency-show-more"
                  >
                    Show more
                  </button>
                }
              }
            </div>

            <!-- Genre & tone -->
            <div class="box">
              <h3 class="title is-5">Genre &amp; tone</h3>
              <datalist id="biblical-genres">
                @for (g of biblicalGenres; track g) {
                  <option [value]="g"></option>
                }
              </datalist>
              <div class="field">
                <label class="label" for="genre">Genre</label>
                <div class="control">
                  <input
                    id="genre"
                    class="input"
                    type="text"
                    maxlength="200"
                    list="biblical-genres"
                    placeholder="e.g. letter, historical narrative, poetry"
                    [ngModel]="genre()"
                    (ngModelChange)="genre.set($event)"
                    data-testid="genre-input"
                  />
                </div>
              </div>
              <div class="field">
                <label class="label" for="tone">Tone</label>
                <div class="control">
                  <textarea
                    id="tone"
                    class="textarea"
                    maxlength="2000"
                    placeholder="The book's overall tone and any shifts you notice"
                    [ngModel]="tone()"
                    (ngModelChange)="tone.set($event)"
                    data-testid="tone-input"
                  ></textarea>
                </div>
              </div>
            </div>

            <!-- Secondary genres: where the genre shifts inside the book -->
            <div class="box" data-testid="structure-secondary-genres">
              <h3 class="title is-5">Secondary genres (where the genre shifts)</h3>
              <p class="help mb-3" data-testid="secondary-genre-help">
                Record a passage whose genre differs from the book's dominant genre — e.g. poetry
                inside a narrative, a hymn inside a letter. The reference is a location you type; no
                verse text is stored.
              </p>
              @for (sg of secondaryGenres(); track $index) {
                <div class="box p-3 mb-2" data-testid="secondary-genre-row">
                  <!-- Genre + reorder/remove controls -->
                  <div class="field has-addons mb-2">
                    <div class="control is-expanded">
                      <input
                        class="input is-small"
                        type="text"
                        maxlength="200"
                        list="biblical-genres"
                        placeholder="Genre, e.g. poetry"
                        [ngModel]="sg.genre"
                        (ngModelChange)="setSecondaryGenre($index, $event)"
                        [attr.aria-label]="'Secondary genre ' + ($index + 1) + ' genre'"
                        data-testid="secondary-genre-input"
                      />
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="$index === 0"
                        (click)="moveSecondaryGenre($index, -1)"
                        [attr.aria-label]="'Move secondary genre ' + ($index + 1) + ' up'"
                        data-testid="secondary-genre-up"
                      >
                        ↑
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="$index === secondaryGenres().length - 1"
                        (click)="moveSecondaryGenre($index, 1)"
                        [attr.aria-label]="'Move secondary genre ' + ($index + 1) + ' down'"
                        data-testid="secondary-genre-down"
                      >
                        ↓
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small is-danger is-outlined"
                        type="button"
                        (click)="removeSecondaryGenre($index)"
                        [attr.aria-label]="'Remove secondary genre ' + ($index + 1)"
                        data-testid="secondary-genre-remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  @if (sg.genre.trim().length === 0) {
                    <p class="help is-danger" data-testid="secondary-genre-blank">
                      Name the genre, or remove this row.
                    </p>
                  }

                  <!-- Passage location: where this genre span starts and stops -->
                  <div class="field is-grouped mb-2">
                    <div class="control is-expanded">
                      <label class="label is-small mb-1" [attr.for]="'secondary-start-' + $index">
                        Starts at
                      </label>
                      <input
                        [id]="'secondary-start-' + $index"
                        class="input is-small"
                        type="text"
                        maxlength="50"
                        placeholder="e.g. 15:1"
                        [ngModel]="sg.startRef"
                        (ngModelChange)="setSecondaryStartRef($index, $event)"
                        [attr.aria-label]="'Secondary genre ' + ($index + 1) + ' starts at'"
                        data-testid="secondary-genre-startref"
                      />
                    </div>
                    <div class="control is-expanded">
                      <label class="label is-small mb-1" [attr.for]="'secondary-end-' + $index">
                        Stops at
                      </label>
                      <input
                        [id]="'secondary-end-' + $index"
                        class="input is-small"
                        type="text"
                        maxlength="50"
                        placeholder="e.g. 15:21"
                        [ngModel]="sg.endRef"
                        (ngModelChange)="setSecondaryEndRef($index, $event)"
                        [attr.aria-label]="'Secondary genre ' + ($index + 1) + ' stops at'"
                        data-testid="secondary-genre-endref"
                      />
                    </div>
                  </div>

                  <!-- Optional notes -->
                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'secondary-notes-' + $index">
                      Notes
                    </label>
                    <textarea
                      [id]="'secondary-notes-' + $index"
                      class="textarea is-small"
                      rows="2"
                      maxlength="1000"
                      placeholder="e.g. the Song of the Sea"
                      [ngModel]="sg.notes"
                      (ngModelChange)="setSecondaryNotes($index, $event)"
                      [attr.aria-label]="'Secondary genre ' + ($index + 1) + ' notes'"
                      data-testid="secondary-genre-notes"
                    ></textarea>
                  </div>
                </div>
              }
              <button
                class="button is-small"
                type="button"
                (click)="addSecondaryGenre()"
                data-testid="secondary-genre-add"
              >
                Add secondary genre
              </button>
            </div>

            <!-- Markers -->
            <div class="box" data-testid="structure-markers">
              <h3 class="title is-5">Structural markers</h3>
              @if (candidates().length > 0) {
                <p class="mb-2">Suggested from the text — accept the ones that are real signals:</p>
                <div class="tags">
                  @for (c of candidates(); track c.start) {
                    <button
                      class="tag is-link is-light"
                      type="button"
                      (click)="acceptCandidate(c)"
                      data-testid="marker-candidate"
                    >
                      {{ c.phrase }} ({{ c.kind }})
                    </button>
                  }
                </div>
              }

              @if (markers().length > 0) {
                <table class="table is-fullwidth" aria-label="Recorded structural markers">
                  <thead>
                    <tr>
                      <th>Phrase</th>
                      <th>Kind</th>
                      <th>Reference</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of markers(); track $index) {
                      <tr data-testid="marker-row">
                        <td>{{ m.phrase }}</td>
                        <td>{{ m.kind }}</td>
                        <td>{{ m.ref }}</td>
                        <td>
                          <button
                            class="button is-small is-danger is-outlined"
                            type="button"
                            [attr.aria-label]="'Remove marker ' + m.phrase"
                            (click)="removeMarker($index)"
                            data-testid="marker-remove"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }

              <div class="field has-addons" data-testid="marker-add">
                <div class="control">
                  <input
                    class="input is-small"
                    type="text"
                    maxlength="200"
                    placeholder="Add a marker phrase"
                    [ngModel]="newMarkerPhrase()"
                    (ngModelChange)="newMarkerPhrase.set($event)"
                    aria-label="New marker phrase"
                    data-testid="marker-add-phrase"
                  />
                </div>
                <div class="control">
                  <div class="select is-small">
                    <select
                      [ngModel]="newMarkerKind()"
                      (ngModelChange)="newMarkerKind.set($event)"
                      aria-label="New marker kind"
                      data-testid="marker-add-kind"
                    >
                      @for (k of markerKinds; track k) {
                        <option [value]="k">{{ k }}</option>
                      }
                    </select>
                  </div>
                </div>
                <div class="control">
                  <button
                    class="button is-small"
                    type="button"
                    (click)="addMarker()"
                    data-testid="marker-add-button"
                  >
                    Add marker
                  </button>
                </div>
              </div>
            </div>

            <!-- Sections -->
            <div class="box" data-testid="structure-sections">
              <h3 class="title is-5">Sections</h3>
              <p class="help mb-3" data-testid="divisions-reminder">
                Chapter, verse, and paragraph divisions are uninspired — verify them against the
                text rather than trusting them; let the author's own signals set your sections.
              </p>
              @for (s of sections(); track $index) {
                <div class="box p-3 mb-2" data-testid="section-row">
                  <!-- Label + reorder/remove controls -->
                  <div class="field has-addons mb-2">
                    <div class="control is-expanded">
                      <input
                        class="input is-small"
                        type="text"
                        maxlength="200"
                        placeholder="Section label"
                        [ngModel]="s.label"
                        (ngModelChange)="setSectionLabel($index, $event)"
                        [attr.aria-label]="'Section ' + ($index + 1) + ' label'"
                        data-testid="section-label"
                      />
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="$index === 0"
                        (click)="moveSection($index, -1)"
                        [attr.aria-label]="'Move section ' + ($index + 1) + ' up'"
                        data-testid="section-up"
                      >
                        ↑
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="$index === sections().length - 1"
                        (click)="moveSection($index, 1)"
                        [attr.aria-label]="'Move section ' + ($index + 1) + ' down'"
                        data-testid="section-down"
                      >
                        ↓
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small is-danger is-outlined"
                        type="button"
                        (click)="removeSection($index)"
                        [attr.aria-label]="'Remove section ' + ($index + 1)"
                        data-testid="section-remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <!-- Passage location: where this section starts and stops -->
                  <div class="field is-grouped mb-2">
                    <div class="control is-expanded">
                      <label class="label is-small mb-1" [attr.for]="'section-start-' + $index">
                        Starts at
                      </label>
                      <input
                        [id]="'section-start-' + $index"
                        class="input is-small"
                        type="text"
                        maxlength="50"
                        placeholder="e.g. 1:1 or “the opening greeting”"
                        [ngModel]="s.startRef"
                        (ngModelChange)="setSectionStartRef($index, $event)"
                        [attr.aria-label]="'Section ' + ($index + 1) + ' starts at'"
                        data-testid="section-start"
                      />
                    </div>
                    <div class="control is-expanded">
                      <label class="label is-small mb-1" [attr.for]="'section-end-' + $index">
                        Stops at
                      </label>
                      <input
                        [id]="'section-end-' + $index"
                        class="input is-small"
                        type="text"
                        maxlength="50"
                        placeholder="e.g. 2:4 or “before the hymn”"
                        [ngModel]="s.endRef"
                        (ngModelChange)="setSectionEndRef($index, $event)"
                        [attr.aria-label]="'Section ' + ($index + 1) + ' stops at'"
                        data-testid="section-end"
                      />
                    </div>
                  </div>

                  <!-- Optional per-section notes -->
                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'section-notes-' + $index">
                      Notes
                    </label>
                    <textarea
                      [id]="'section-notes-' + $index"
                      class="textarea is-small"
                      rows="2"
                      maxlength="1000"
                      placeholder="Why this is a section — the author's signals that mark its edges"
                      [ngModel]="s.notes"
                      (ngModelChange)="setSectionNotes($index, $event)"
                      [attr.aria-label]="'Section ' + ($index + 1) + ' notes'"
                      data-testid="section-notes"
                    ></textarea>
                  </div>
                </div>
              }
              <button
                class="button is-small"
                type="button"
                (click)="addSection()"
                data-testid="section-add"
              >
                Add section
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
                data-testid="structure-save"
              >
                Save
              </button>
            </div>
            <div aria-live="polite">
              @if (saved()) {
                <p class="has-text-success" data-testid="structure-saved">Saved.</p>
              }
              @if (saveError()) {
                <p class="has-text-danger" data-testid="structure-save-error">
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
              data-testid="structure-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="structure-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="structure-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="structure-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="structure-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="structure-retry-button"
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
export class StructureViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly structureStudy = inject(StructureStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);

  // Derived (not persisted)
  readonly stopWords = signal(true);
  private readonly scrollText = signal('');
  readonly frequency = computed(() => wordFrequency(this.scrollText(), this.stopWords()));
  readonly candidates = signal<MarkerCandidate[]>([]);
  readonly visibleCount = signal(FREQUENCY_PAGE);
  readonly visibleFrequency = computed(() => this.frequency().slice(0, this.visibleCount()));

  // Persisted worksheet
  readonly genre = signal('');
  readonly tone = signal('');
  readonly markers = signal<StructureMarker[]>([]);
  readonly sections = signal<StructureSection[]>([]);
  readonly elements = signal<StructureElement[]>([]);
  readonly secondaryGenres = signal<SecondaryGenre[]>([]);

  // Add-marker form
  readonly newMarkerPhrase = signal('');
  readonly newMarkerKind = signal<StructureMarker['kind']>('transition');
  readonly markerKinds = MARKER_KINDS;
  readonly biblicalGenres = BIBLICAL_GENRES;

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  scrollStudyId = '';

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.load();
  }

  /** Load the scroll study, derive the frequency view + marker candidates, pre-fill any saved study. */
  load(): void {
    this.state.set('loading');
    this.saved.set(false);
    this.saveError.set(false);
    this.scrollStudy.getScrollStudy(this.scrollStudyId).subscribe({
      next: (s) => {
        this.study.set(s);
        if (s.status === 'ready') {
          this.scrollText.set(s.scrollText);
          this.candidates.set(suggestMarkers(s.scrollText));
          this.visibleCount.set(FREQUENCY_PAGE);
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

  /** Fetch the saved study (if any) and pre-fill the worksheet. A 404 means "none yet". */
  private loadSaved(): void {
    this.structureStudy.get(this.scrollStudyId).subscribe({
      next: (saved) => {
        this.genre.set(saved.genre);
        this.tone.set(saved.tone);
        this.markers.set(saved.markers);
        this.sections.set(saved.sections);
        this.elements.set(saved.elements);
        // Backward compatibility: records saved before this feature have no secondaryGenres field.
        this.secondaryGenres.set(saved.secondaryGenres ?? []);
      },
      error: () => {
        // 404 (no saved study) or a transient error: leave the empty editable worksheet in place.
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

  setStopWords(on: boolean): void {
    this.stopWords.set(on);
    this.visibleCount.set(FREQUENCY_PAGE);
  }

  showMore(): void {
    this.visibleCount.update((n) => n + FREQUENCY_PAGE);
  }

  // --- markers ---

  acceptCandidate(c: MarkerCandidate): void {
    this.markers.update((m) => [
      ...m,
      { kind: c.kind, phrase: c.phrase, ref: String(c.start), notes: '' },
    ]);
  }

  addMarker(): void {
    const phrase = this.newMarkerPhrase().trim();
    if (phrase.length === 0) {
      return;
    }
    this.markers.update((m) => [...m, { kind: this.newMarkerKind(), phrase, ref: '', notes: '' }]);
    this.newMarkerPhrase.set('');
  }

  removeMarker(index: number): void {
    this.markers.update((m) => m.filter((_, i) => i !== index));
  }

  // --- sections ---

  addSection(): void {
    this.sections.update((s) => [...s, { label: '', startRef: '', endRef: '', notes: '' }]);
  }

  setSectionLabel(index: number, label: string): void {
    this.sections.update((s) => s.map((sec, i) => (i === index ? { ...sec, label } : sec)));
  }

  setSectionStartRef(index: number, startRef: string): void {
    this.sections.update((s) => s.map((sec, i) => (i === index ? { ...sec, startRef } : sec)));
  }

  setSectionEndRef(index: number, endRef: string): void {
    this.sections.update((s) => s.map((sec, i) => (i === index ? { ...sec, endRef } : sec)));
  }

  setSectionNotes(index: number, notes: string): void {
    this.sections.update((s) => s.map((sec, i) => (i === index ? { ...sec, notes } : sec)));
  }

  removeSection(index: number): void {
    this.sections.update((s) => s.filter((_, i) => i !== index));
  }

  moveSection(index: number, delta: number): void {
    const target = index + delta;
    this.sections.update((s) => {
      if (target < 0 || target >= s.length) {
        return s;
      }
      const next = [...s];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  // --- secondary genres (in-book genre shifts) ---

  addSecondaryGenre(): void {
    this.secondaryGenres.update((s) => [...s, { genre: '', startRef: '', endRef: '', notes: '' }]);
  }

  setSecondaryGenre(index: number, genre: string): void {
    this.secondaryGenres.update((s) => s.map((sg, i) => (i === index ? { ...sg, genre } : sg)));
  }

  setSecondaryStartRef(index: number, startRef: string): void {
    this.secondaryGenres.update((s) => s.map((sg, i) => (i === index ? { ...sg, startRef } : sg)));
  }

  setSecondaryEndRef(index: number, endRef: string): void {
    this.secondaryGenres.update((s) => s.map((sg, i) => (i === index ? { ...sg, endRef } : sg)));
  }

  setSecondaryNotes(index: number, notes: string): void {
    this.secondaryGenres.update((s) => s.map((sg, i) => (i === index ? { ...sg, notes } : sg)));
  }

  removeSecondaryGenre(index: number): void {
    this.secondaryGenres.update((s) => s.filter((_, i) => i !== index));
  }

  moveSecondaryGenre(index: number, delta: number): void {
    const target = index + delta;
    this.secondaryGenres.update((s) => {
      if (target < 0 || target >= s.length) {
        return s;
      }
      const next = [...s];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  // --- save ---

  save(): void {
    // Drop sections the student left with an empty label before persisting.
    const sections = this.sections().filter((s) => s.label.trim().length > 0);
    // Drop secondary-genre rows left with a blank genre; trim the genre on the rest.
    const secondaryGenres = this.secondaryGenres()
      .map((sg) => ({ ...sg, genre: sg.genre.trim() }))
      .filter((sg) => sg.genre.length > 0);
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.structureStudy
      .save(this.scrollStudyId, {
        genre: this.genre().trim(),
        tone: this.tone().trim(),
        markers: this.markers(),
        sections,
        elements: this.elements(),
        secondaryGenres,
      })
      .subscribe({
        next: (savedStudy) => {
          this.saving.set(false);
          this.saved.set(true);
          // Reflect the server-normalised worksheet (e.g. dropped empty-label sections).
          this.sections.set(savedStudy.sections);
          this.secondaryGenres.set(savedStudy.secondaryGenres ?? []);
        },
        error: () => {
          this.saving.set(false);
          this.saveError.set(true);
        },
      });
  }
}
