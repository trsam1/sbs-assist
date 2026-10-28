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
import { InterrogationStudyService } from '../interrogation-study.service';
import { InterrogationEntry } from '../models';
import {
  INTERROGATION_CATEGORIES,
  SUGGESTED_TAGS,
  TAG_MAX,
  normalizeTags,
} from '../interrogation-questions';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

/** A blank entry (default category: 'what'). */
function blankEntry(): InterrogationEntry {
  return {
    question: '',
    category: 'what',
    tags: [],
    passageRef: '',
    answer: '',
    notes: '',
  };
}

@Component({
  selector: 'app-interrogate-view',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Interrogation study">
      <div class="container">
        <datalist id="interrogation-tag-suggestions">
          @for (t of suggestedTags; track t) {
            <option [value]="t"></option>
          }
        </datalist>

        @if (study(); as s) {
          <h2 class="title is-4" data-testid="interrogate-book">
            {{ s.bookName }} — Interrogate the Text
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
              Interrogate the passage: ask it your own questions — who, what, when, where, why, how
              — and record the answers you find <em>in the text itself</em>. Tag each Q&amp;A with
              the subjects it touches so you can surface a theme (what the passage reveals about
              God, its commands, its context) across your study.
            </p>

            <!-- Tag filter -->
            @if (tagsInUse().length > 0) {
              <div class="box" data-testid="tag-filter">
                <h3 class="title is-6 mb-2">Filter by tag</h3>
                <p class="help mb-2">
                  Show only entries carrying all selected tags. The filter is a view only — it does
                  not change what you save.
                </p>
                <div class="tags" role="group" aria-label="Tag filter">
                  @for (t of tagsInUse(); track t) {
                    <button
                      type="button"
                      class="tag is-medium"
                      [class.is-link]="tagFilter().includes(t)"
                      [attr.aria-pressed]="tagFilter().includes(t)"
                      (click)="toggleFilter(t)"
                      data-testid="tag-filter-option"
                    >
                      {{ t }}
                    </button>
                  }
                  @if (tagFilter().length > 0) {
                    <button
                      type="button"
                      class="tag is-medium is-delete-adjacent button is-text"
                      (click)="clearFilter()"
                      data-testid="tag-filter-clear"
                    >
                      Clear filter
                    </button>
                  }
                </div>
              </div>
            }

            <!-- Entries -->
            <div class="box" data-testid="interrogation-entries">
              <h3 class="title is-5">Questions &amp; answers</h3>
              @if (visibleEntries().length === 0) {
                <div role="status" data-testid="interrogate-empty" class="mb-3">
                  @if (entries().length === 0) {
                    No questions yet. Add one below.
                  } @else {
                    No entries match the selected tags.
                  }
                </div>
              }
              @for (pair of visibleEntries(); track pair.index) {
                <div class="box p-3 mb-2" data-testid="interrogation-entry-row">
                  <div class="field is-grouped is-align-items-end mb-2">
                    <div class="control">
                      <label class="label is-small mb-1" [attr.for]="'category-' + pair.index"
                        >Category</label
                      >
                      <div class="select is-small">
                        <select
                          [id]="'category-' + pair.index"
                          [ngModel]="pair.entry.category"
                          (ngModelChange)="setField(pair.index, 'category', $event)"
                          [attr.aria-label]="'Entry ' + (pair.index + 1) + ' category'"
                          data-testid="category-select"
                        >
                          @for (c of categories; track c) {
                            <option [value]="c">{{ c }}</option>
                          }
                        </select>
                      </div>
                    </div>
                    <div class="control is-expanded"></div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="pair.index === 0"
                        (click)="moveUp(pair.index)"
                        [attr.aria-label]="'Move entry ' + (pair.index + 1) + ' up'"
                        data-testid="entry-reorder"
                      >
                        ↑
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small is-danger is-outlined"
                        type="button"
                        (click)="removeEntry(pair.index)"
                        [attr.aria-label]="'Remove entry ' + (pair.index + 1)"
                        data-testid="entry-remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'question-' + pair.index"
                      >Question</label
                    >
                    <input
                      [id]="'question-' + pair.index"
                      class="input is-small"
                      type="text"
                      maxlength="500"
                      placeholder="e.g. Why does the author address the reader here?"
                      [ngModel]="pair.entry.question"
                      (ngModelChange)="setField(pair.index, 'question', $event)"
                      data-testid="question-input"
                    />
                    @if (showBlankWarning() && pair.entry.question.trim().length === 0) {
                      <p class="help is-danger" role="alert" data-testid="question-blank">
                        A question is required — blank rows are dropped when you save.
                      </p>
                    }
                  </div>

                  <!-- Tags editor -->
                  <div class="field" role="group" aria-label="Tags">
                    <p class="label is-small mb-1" aria-hidden="true">Tags</p>
                    @if (pair.entry.tags.length > 0) {
                      <div class="tags mb-1">
                        @for (tag of pair.entry.tags; track tag) {
                          <span class="tag is-info is-light" data-testid="tag-chip">
                            {{ tag }}
                            <button
                              type="button"
                              class="delete is-small"
                              (click)="removeTag(pair.index, tag)"
                              [attr.aria-label]="'Remove tag ' + tag"
                              data-testid="tag-remove"
                            ></button>
                          </span>
                        }
                      </div>
                    }
                    <div class="field has-addons">
                      <div class="control is-expanded">
                        <input
                          class="input is-small"
                          type="text"
                          list="interrogation-tag-suggestions"
                          [maxlength]="TAG_MAX"
                          placeholder="Add a subject tag (e.g. about-God)"
                          [ngModel]="tagDrafts()[pair.index] ?? ''"
                          (ngModelChange)="setTagDraft(pair.index, $event)"
                          (keydown.enter)="addTag(pair.index); $event.preventDefault()"
                          [attr.aria-label]="'Add tag to entry ' + (pair.index + 1)"
                          data-testid="tag-add-input"
                        />
                      </div>
                      <div class="control">
                        <button
                          class="button is-small"
                          type="button"
                          (click)="addTag(pair.index)"
                          data-testid="tag-add-button"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'passage-' + pair.index"
                      >Passage reference (optional)</label
                    >
                    <input
                      [id]="'passage-' + pair.index"
                      class="input is-small"
                      type="text"
                      maxlength="50"
                      placeholder="e.g. 2:7 (location only — no verse text)"
                      [ngModel]="pair.entry.passageRef"
                      (ngModelChange)="setField(pair.index, 'passageRef', $event)"
                      data-testid="passage-ref"
                    />
                  </div>

                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'answer-' + pair.index"
                      >Answer (from the text)</label
                    >
                    <textarea
                      [id]="'answer-' + pair.index"
                      class="textarea is-small"
                      rows="3"
                      maxlength="4000"
                      placeholder="What the passage itself answers"
                      [ngModel]="pair.entry.answer"
                      (ngModelChange)="setField(pair.index, 'answer', $event)"
                      data-testid="answer-input"
                    ></textarea>
                  </div>

                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'notes-' + pair.index"
                      >Notes</label
                    >
                    <textarea
                      [id]="'notes-' + pair.index"
                      class="textarea is-small"
                      rows="2"
                      maxlength="1000"
                      [ngModel]="pair.entry.notes"
                      (ngModelChange)="setField(pair.index, 'notes', $event)"
                      data-testid="entry-notes"
                    ></textarea>
                  </div>
                </div>
              }
              <button
                class="button is-small"
                type="button"
                (click)="addEntry()"
                data-testid="interrogation-entry-add"
              >
                Add question
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
                data-testid="interrogate-save"
              >
                Save
              </button>
            </div>
            <div aria-live="polite">
              @if (saved()) {
                <p class="has-text-success" data-testid="interrogate-saved">Saved.</p>
              }
              @if (saveError()) {
                <p class="has-text-danger" data-testid="interrogate-save-error">
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
              data-testid="interrogate-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="interrogate-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="interrogate-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="interrogate-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="interrogate-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="interrogate-retry-button"
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
export class InterrogateViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly interrogationStudy = inject(InterrogationStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);

  readonly entries = signal<InterrogationEntry[]>([]);
  /** Per-entry-index add-tag draft text. */
  readonly tagDrafts = signal<Record<number, string>>({});
  /** Selected filter tags (AND semantics); view-only, not persisted. */
  readonly tagFilter = signal<string[]>([]);
  /** Flipped on a save attempt so blank-question rows surface inline. */
  readonly showBlankWarning = signal(false);

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  readonly categories = INTERROGATION_CATEGORIES;
  readonly suggestedTags = SUGGESTED_TAGS;
  protected readonly TAG_MAX = TAG_MAX;

  scrollStudyId = '';

  /** Distinct tags currently used across all entries (for the filter bar), order of first use. */
  readonly tagsInUse = computed(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of this.entries()) {
      for (const t of e.tags) {
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
    }
    return out;
  });

  /** Entries that pass the tag filter, paired with their index in the full list. */
  readonly visibleEntries = computed(() => {
    const filter = this.tagFilter();
    return this.entries()
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => filter.every((t) => entry.tags.includes(t)));
  });

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
    this.interrogationStudy.get(this.scrollStudyId).subscribe({
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

  // --- entries ---

  addEntry(): void {
    this.entries.update((e) => [...e, blankEntry()]);
  }

  removeEntry(index: number): void {
    this.entries.update((e) => e.filter((_, i) => i !== index));
  }

  moveUp(index: number): void {
    if (index <= 0) return;
    this.entries.update((e) => {
      const next = [...e];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  setField(
    index: number,
    field: 'question' | 'category' | 'passageRef' | 'answer' | 'notes',
    value: string,
  ): void {
    this.entries.update((e) =>
      e.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }

  // --- tags ---

  setTagDraft(index: number, value: string): void {
    this.tagDrafts.update((d) => ({ ...d, [index]: value }));
  }

  addTag(index: number): void {
    const draft = this.tagDrafts()[index] ?? '';
    const [normalized] = normalizeTags([draft]);
    if (!normalized) return; // blank/whitespace-only
    this.entries.update((e) =>
      e.map((entry, i) => {
        if (i !== index) return entry;
        if (entry.tags.includes(normalized)) return entry; // de-dupe
        return { ...entry, tags: [...entry.tags, normalized] };
      }),
    );
    this.setTagDraft(index, '');
  }

  removeTag(index: number, tag: string): void {
    this.entries.update((e) =>
      e.map((entry, i) =>
        i === index ? { ...entry, tags: entry.tags.filter((t) => t !== tag) } : entry,
      ),
    );
    // Drop the removed tag from the active filter if it is no longer used anywhere.
    if (!this.tagsInUse().includes(tag)) {
      this.tagFilter.update((f) => f.filter((t) => t !== tag));
    }
  }

  // --- tag filter (view-only) ---

  toggleFilter(tag: string): void {
    this.tagFilter.update((f) => (f.includes(tag) ? f.filter((t) => t !== tag) : [...f, tag]));
  }

  clearFilter(): void {
    this.tagFilter.set([]);
  }

  // --- save ---

  save(): void {
    this.showBlankWarning.set(true);
    // Drop entries with a blank question before persisting; normalize tags client-side (server
    // is authoritative but this keeps the reflected state consistent).
    const entries = this.entries()
      .filter((e) => e.question.trim().length > 0)
      .map((e) => ({ ...e, tags: normalizeTags(e.tags) }));
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.interrogationStudy.save(this.scrollStudyId, { entries }).subscribe({
      next: (savedStudy) => {
        this.saving.set(false);
        this.saved.set(true);
        this.showBlankWarning.set(false);
        this.entries.set(savedStudy.entries);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(true);
      },
    });
  }
}
