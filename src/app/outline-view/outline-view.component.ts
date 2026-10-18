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
import { OutlineStudyService } from '../outline-study.service';
import { StructureStudyService } from '../structure-study.service';
import { OutlineGrouping, OutlineParagraph } from '../models';
import { outlineLabels } from '../outline-number';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

/**
 * Keep every grouping's span valid against the current paragraph list: clamp to range, drop any
 * grouping that no longer covers a paragraph, and (because paragraphs are only ever moved or
 * removed, never re-indexed arbitrarily) rely on the editing handlers to keep spans contiguous.
 * This is the single place structural invariants are enforced on the client; the server
 * re-validates independently.
 */
function normalize(
  paragraphs: OutlineParagraph[],
  groupings: OutlineGrouping[],
): { paragraphs: OutlineParagraph[]; groupings: OutlineGrouping[] } {
  const last = paragraphs.length - 1;
  const kept: OutlineGrouping[] = [];
  for (const g of groupings) {
    if (last < 0) continue; // no paragraphs → no groupings survive
    const start = Math.max(0, Math.min(g.startIndex, last));
    const end = Math.max(0, Math.min(g.endIndex, last));
    if (start > end) continue;
    kept.push({ ...g, startIndex: start, endIndex: end });
  }
  return { paragraphs, groupings: kept };
}

@Component({
  selector: 'app-outline-view',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Outline study">
      <div class="container">
        @if (study(); as s) {
          <h2 class="title is-4" data-testid="outline-book">
            {{ s.bookName }} — Provisional Outline
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
              Build your outline left to right: list the book's paragraphs on the left (each with a
              start/stop reference and a one-line main idea), then select a run of related
              paragraphs and <strong>merge</strong> them into a labelled bracket in the next column.
              Merge brackets again to group them into larger divisions. The standard outline form on
              the right is numbered for you — the thinking is yours.
            </p>

            <!-- Import from Step 7 -->
            @if (canImport()) {
              <div class="notification is-link is-light" data-testid="outline-import">
                <p class="mb-2">
                  You have a saved Step 7 structure for this book. Import its sections as your
                  starting paragraphs so you don't re-type them, then bracket and group from there.
                </p>
                <button
                  class="button is-small is-link"
                  type="button"
                  (click)="importFromStep7()"
                  data-testid="outline-import-button"
                >
                  Import sections from Step 7
                </button>
              </div>
            }

            <!-- Merge toolbar: acts on the current contiguous paragraph selection -->
            <div class="box" data-testid="outline-flow">
              <div class="level is-mobile mb-3">
                <div class="level-left">
                  <h3 class="title is-5 mb-0">Paragraphs &amp; groupings</h3>
                </div>
                <div class="level-right">
                  <button
                    class="button is-small is-link"
                    type="button"
                    [disabled]="!canMergeSelection()"
                    (click)="mergeSelection()"
                    data-testid="merge-selection"
                  >
                    Merge selected → bracket
                  </button>
                  @if (selection().length > 0) {
                    <button
                      class="button is-small ml-2"
                      type="button"
                      (click)="clearSelection()"
                      data-testid="clear-selection"
                    >
                      Clear selection
                    </button>
                  }
                </div>
              </div>

              @if (selectionError()) {
                <p class="help is-danger" data-testid="selection-error">
                  Select a single unbroken run of adjacent paragraphs to merge.
                </p>
              }

              @if (paragraphs().length === 0) {
                <p class="help mb-3" data-testid="outline-empty">
                  No paragraphs yet. Add one per paragraph of the book, then bracket and group them.
                </p>
              }

              <!-- Left-to-right flow: paragraph column + one column per merge level -->
              @if (paragraphs().length > 0) {
                <div
                  class="outline-flow-grid"
                  data-testid="flow-grid"
                  [style.grid-template-columns]="gridTemplateColumns()"
                  [style.display]="'grid'"
                  [style.gap.rem]="0.5"
                >
                  <!-- Column 0: the paragraph rows -->
                  @for (p of paragraphs(); track $index; let i = $index) {
                    <div
                      class="box p-3 outline-paragraph"
                      data-testid="paragraph-row"
                      [class.is-selected]="isSelected(i)"
                      [style.grid-column]="1"
                      [style.grid-row]="i + 1"
                    >
                      <div class="field has-addons mb-2">
                        <div class="control">
                          <button
                            class="button is-small"
                            type="button"
                            [class.is-link]="isSelected(i)"
                            (click)="toggleSelect(i)"
                            [attr.aria-pressed]="isSelected(i)"
                            [attr.aria-label]="'Select paragraph ' + (i + 1)"
                            data-testid="paragraph-select"
                          >
                            {{ isSelected(i) ? '☑' : '☐' }}
                          </button>
                        </div>
                        <div class="control is-expanded">
                          <input
                            class="input is-small"
                            type="text"
                            maxlength="200"
                            placeholder="Main idea (one statement)"
                            [ngModel]="p.mainIdea"
                            (ngModelChange)="setParagraphMainIdea(i, $event)"
                            [attr.aria-label]="'Paragraph ' + (i + 1) + ' main idea'"
                            data-testid="paragraph-main-idea"
                          />
                        </div>
                        <div class="control">
                          <button
                            class="button is-small"
                            type="button"
                            [disabled]="i === 0"
                            (click)="moveParagraph(i, -1)"
                            [attr.aria-label]="'Move paragraph ' + (i + 1) + ' up'"
                            data-testid="paragraph-up"
                          >
                            ↑
                          </button>
                        </div>
                        <div class="control">
                          <button
                            class="button is-small"
                            type="button"
                            [disabled]="i === paragraphs().length - 1"
                            (click)="moveParagraph(i, 1)"
                            [attr.aria-label]="'Move paragraph ' + (i + 1) + ' down'"
                            data-testid="paragraph-down"
                          >
                            ↓
                          </button>
                        </div>
                        <div class="control">
                          <button
                            class="button is-small is-danger is-outlined"
                            type="button"
                            (click)="removeParagraph(i)"
                            [attr.aria-label]="'Remove paragraph ' + (i + 1)"
                            data-testid="paragraph-remove"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div class="field is-grouped mb-0">
                        <div class="control is-expanded">
                          <input
                            class="input is-small"
                            type="text"
                            maxlength="50"
                            placeholder="Starts at (e.g. 1:1)"
                            [ngModel]="p.startRef"
                            (ngModelChange)="setParagraphStartRef(i, $event)"
                            [attr.aria-label]="'Paragraph ' + (i + 1) + ' starts at'"
                            data-testid="paragraph-start"
                          />
                        </div>
                        <div class="control is-expanded">
                          <input
                            class="input is-small"
                            type="text"
                            maxlength="50"
                            placeholder="Stops at (e.g. 1:11)"
                            [ngModel]="p.endRef"
                            (ngModelChange)="setParagraphEndRef(i, $event)"
                            [attr.aria-label]="'Paragraph ' + (i + 1) + ' stops at'"
                            data-testid="paragraph-end"
                          />
                        </div>
                      </div>
                    </div>
                  }

                  <!-- Merge columns: each grouping spans the grid rows of the paragraphs it covers -->
                  @for (g of groupingViews(); track g.ref) {
                    <div
                      class="box p-2 outline-grouping"
                      data-testid="grouping-block"
                      [style.grid-column]="g.column + 1"
                      [style.grid-row]="g.startIndex + 1 + ' / ' + (g.endIndex + 2)"
                    >
                      <input
                        class="input is-small mb-1"
                        type="text"
                        maxlength="200"
                        placeholder="Bracket title"
                        [ngModel]="g.title"
                        (ngModelChange)="setGroupingTitle(g.ref, $event)"
                        [attr.aria-label]="'Grouping title'"
                        data-testid="grouping-title"
                      />
                      <div class="buttons are-small mb-0">
                        <button
                          class="button is-small"
                          type="button"
                          [disabled]="!canPromote(g.ref)"
                          (click)="promoteGrouping(g.ref)"
                          [attr.aria-label]="'Merge this bracket with the next into a larger group'"
                          data-testid="grouping-promote"
                        >
                          Group with next →
                        </button>
                        <button
                          class="button is-small is-danger is-outlined"
                          type="button"
                          (click)="removeGrouping(g.ref)"
                          [attr.aria-label]="'Remove this grouping'"
                          data-testid="grouping-remove"
                        >
                          Un-merge
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }

              <button
                class="button is-small mt-3"
                type="button"
                (click)="addParagraph()"
                data-testid="paragraph-add"
              >
                Add paragraph
              </button>
            </div>

            <!-- Standard outline form (derived) -->
            @if (paragraphs().length > 0) {
              <div class="box" data-testid="outline-standard-form">
                <h3 class="title is-5">Standard outline form</h3>
                <ul class="outline-standard">
                  @for (row of labels(); track $index) {
                    <li data-testid="standard-row" [style.margin-left.rem]="row.level * 1.5">
                      <strong>{{ row.label }}.</strong> {{ rowText(row.kind, row.ref) }}
                    </li>
                  }
                </ul>
              </div>
            }

            <!-- Save -->
            <div class="field">
              <button
                class="button is-primary"
                type="button"
                [class.is-loading]="saving()"
                [disabled]="saving()"
                (click)="save()"
                data-testid="outline-save"
              >
                Save
              </button>
            </div>
            <div aria-live="polite">
              @if (saved()) {
                <p class="has-text-success" data-testid="outline-saved">Saved.</p>
              }
              @if (saveError()) {
                <p class="has-text-danger" data-testid="outline-save-error">
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
              data-testid="outline-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="outline-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="outline-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="outline-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="outline-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="outline-retry-button"
              >
                Retry
              </button>
            </div>
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      .outline-paragraph.is-selected {
        outline: 2px solid var(--bulma-link, #485fc7);
      }
      .outline-grouping {
        align-self: stretch;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
    `,
  ],
})
export class OutlineViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly outlineStudy = inject(OutlineStudyService);
  private readonly structureStudy = inject(StructureStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);

  // Persisted worksheet
  readonly paragraphs = signal<OutlineParagraph[]>([]);
  readonly groupings = signal<OutlineGrouping[]>([]);

  // Transient UI: the current contiguous paragraph selection (sorted indices) for a merge.
  readonly selection = signal<number[]>([]);
  readonly selectionError = signal(false);

  // Step 7 seed (for the import affordance)
  private readonly structureSections = signal<OutlineParagraph[]>([]);
  private readonly hasStructureSections = signal(false);

  // Derived standard-form labels (not persisted)
  readonly labels = computed(() => outlineLabels(this.paragraphs(), this.groupings()));

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  /** The highest merge column in use (0 when there are no groupings). */
  readonly maxColumn = computed(() => this.groupings().reduce((m, g) => Math.max(m, g.column), 0));

  /** CSS grid columns: one for the paragraph column plus one per merge column. */
  readonly gridTemplateColumns = computed(() => {
    const cols = this.maxColumn() + 1;
    return `minmax(18rem, 2fr)` + ` 1fr`.repeat(Math.max(0, cols - 1));
  });

  /** Groupings paired with their array ref, for template tracking. */
  readonly groupingViews = computed(() => this.groupings().map((g, ref) => ({ ...g, ref })));

  /** Import is offered only when a Step 7 structure has sections AND the outline is still empty. */
  readonly canImport = computed(
    () => this.hasStructureSections() && this.paragraphs().length === 0,
  );

  scrollStudyId = '';

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.load();
  }

  /** Load the scroll study, then pre-fill any saved outline and the Step 7 seed. */
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

  /** Fetch the saved outline (if any) and the Step 7 structure (for import). 404s are "none yet". */
  private loadSaved(): void {
    this.outlineStudy.get(this.scrollStudyId).subscribe({
      next: (saved) => {
        const n = normalize(saved.paragraphs, saved.groupings);
        this.paragraphs.set(n.paragraphs);
        this.groupings.set(n.groupings);
      },
      error: () => {
        // 404 (no saved study) or a transient error: leave the empty editable worksheet in place.
      },
    });
    this.structureStudy.get(this.scrollStudyId).subscribe({
      next: (struct) => {
        // Map Step 7 sections → candidate paragraphs (label → mainIdea).
        this.structureSections.set(
          struct.sections.map((sec) => ({
            startRef: sec.startRef,
            endRef: sec.endRef,
            mainIdea: sec.label,
            notes: sec.notes,
          })),
        );
        this.hasStructureSections.set(struct.sections.length > 0);
      },
      error: () => {
        this.hasStructureSections.set(false);
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

  /** The text shown for a standard-form row (grouping title or paragraph main idea). */
  rowText(kind: 'grouping' | 'paragraph', ref: number): string {
    return kind === 'grouping'
      ? (this.groupings()[ref]?.title ?? '')
      : (this.paragraphs()[ref]?.mainIdea ?? '');
  }

  // --- paragraph column ---

  addParagraph(): void {
    this.update((paragraphs, groupings) => {
      paragraphs.push({ startRef: '', endRef: '', mainIdea: '', notes: '' });
      return { paragraphs, groupings };
    });
  }

  setParagraphMainIdea(index: number, mainIdea: string): void {
    this.patchParagraph(index, { mainIdea });
  }
  setParagraphStartRef(index: number, startRef: string): void {
    this.patchParagraph(index, { startRef });
  }
  setParagraphEndRef(index: number, endRef: string): void {
    this.patchParagraph(index, { endRef });
  }
  setParagraphNotes(index: number, notes: string): void {
    this.patchParagraph(index, { notes });
  }

  private patchParagraph(index: number, patch: Partial<OutlineParagraph>): void {
    this.paragraphs.update((ps) => ps.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  /**
   * Move a paragraph by `delta`. To keep every grouping's span contiguous, a move is only allowed
   * when it does not break any grouping: a paragraph may not jump across a grouping boundary. When
   * the swap would split a grouping, it is rejected (the student un-merges first). This guarantees
   * spans stay contiguous without silently reshaping the student's groupings.
   */
  moveParagraph(index: number, delta: number): void {
    const target = index + delta;
    const ps = this.paragraphs();
    if (target < 0 || target >= ps.length) return;

    // A swap of indices [a, b] (adjacent) is safe only if no grouping has exactly one of them as
    // an interior/edge such that the swap would make its covered set non-contiguous. Since we only
    // swap adjacent paragraphs, the covered index SET of every grouping is unchanged iff both or
    // neither of {index, target} are inside its span. Reject when a grouping contains exactly one.
    const a = Math.min(index, target);
    const b = Math.max(index, target);
    const breaks = this.groupings().some((g) => {
      const aIn = a >= g.startIndex && a <= g.endIndex;
      const bIn = b >= g.startIndex && b <= g.endIndex;
      return aIn !== bIn;
    });
    if (breaks) {
      this.selectionError.set(false);
      return; // no-op: moving would split a grouping; student un-merges first
    }

    this.update((paragraphs, groupings) => {
      const next = [...paragraphs];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { paragraphs: next, groupings };
    });
  }

  /**
   * Remove a paragraph, shift later paragraph indices down, and update grouping spans so each
   * still covers the same remaining paragraphs. A grouping that covered only the removed paragraph
   * is dropped by `normalize`; one that covered it among others shrinks by one, staying contiguous.
   */
  removeParagraph(index: number): void {
    this.update((paragraphs, groupings) => {
      const nextParas = paragraphs.filter((_, i) => i !== index);
      const nextGroupings = groupings
        .map((g) => {
          let { startIndex, endIndex } = g;
          if (index < startIndex) {
            startIndex -= 1;
            endIndex -= 1;
          } else if (index >= startIndex && index <= endIndex) {
            endIndex -= 1; // removing one covered paragraph shrinks the (contiguous) span by one
          }
          return { ...g, startIndex, endIndex };
        })
        .filter((g) => g.endIndex >= g.startIndex && g.startIndex >= 0);
      return { paragraphs: nextParas, groupings: nextGroupings };
    });
    this.clearSelection();
  }

  // --- selection + merge (bracket) ---

  isSelected(index: number): boolean {
    return this.selection().includes(index);
  }

  /** Toggle a paragraph in/out of the selection, keeping it sorted. */
  toggleSelect(index: number): void {
    this.selectionError.set(false);
    this.selection.update((sel) => {
      const has = sel.includes(index);
      const next = has ? sel.filter((i) => i !== index) : [...sel, index];
      return next.sort((x, y) => x - y);
    });
  }

  clearSelection(): void {
    this.selection.set([]);
    this.selectionError.set(false);
  }

  /** A selection is mergeable when it is two or more paragraphs forming an unbroken run. */
  canMergeSelection(): boolean {
    const sel = this.selection();
    if (sel.length < 2) return false;
    return sel[sel.length - 1] - sel[0] === sel.length - 1;
  }

  /** Create a column-1 grouping over the selected contiguous run (sub-step 3: bracket). */
  mergeSelection(): void {
    const sel = this.selection();
    if (sel.length < 2) {
      this.selectionError.set(true);
      return;
    }
    if (!this.canMergeSelection()) {
      this.selectionError.set(true);
      return;
    }
    const startIndex = sel[0];
    const endIndex = sel[sel.length - 1];
    this.update((paragraphs, groupings) => {
      groupings.push({ column: 1, startIndex, endIndex, title: '', notes: '' });
      return { paragraphs, groupings };
    });
    this.clearSelection();
  }

  setGroupingTitle(ref: number, title: string): void {
    this.groupings.update((gs) => gs.map((g, i) => (i === ref ? { ...g, title } : g)));
  }
  setGroupingNotes(ref: number, notes: string): void {
    this.groupings.update((gs) => gs.map((g, i) => (i === ref ? { ...g, notes } : g)));
  }

  /**
   * A grouping can be promoted (grouped with the next grouping in the same column, to its right)
   * when there is an adjacent same-column grouping whose span immediately follows it.
   */
  canPromote(ref: number): boolean {
    return this.nextSameColumnAdjacent(ref) !== -1;
  }

  /** Index of the same-column grouping immediately following `ref`'s span, or -1. */
  private nextSameColumnAdjacent(ref: number): number {
    const gs = this.groupings();
    const g = gs[ref];
    if (!g) return -1;
    for (let i = 0; i < gs.length; i++) {
      if (i === ref) continue;
      const o = gs[i];
      if (o.column === g.column && o.startIndex === g.endIndex + 1) return i;
    }
    return -1;
  }

  /**
   * Group this bracket with the adjacent one to its right into a new grouping one column over
   * (sub-step 5: group). The two child brackets remain; the new parent spans their union, which is
   * contiguous by construction.
   */
  promoteGrouping(ref: number): void {
    const nextRef = this.nextSameColumnAdjacent(ref);
    if (nextRef === -1) return;
    const gs = this.groupings();
    const g = gs[ref];
    const o = gs[nextRef];
    const startIndex = Math.min(g.startIndex, o.startIndex);
    const endIndex = Math.max(g.endIndex, o.endIndex);
    const column = g.column + 1;
    this.update((paragraphs, groupings) => {
      groupings.push({ column, startIndex, endIndex, title: '', notes: '' });
      return { paragraphs, groupings };
    });
  }

  removeGrouping(ref: number): void {
    this.update((paragraphs, groupings) => ({
      paragraphs,
      groupings: groupings.filter((_, i) => i !== ref),
    }));
  }

  // --- seed from Step 7 ---

  /** Create one paragraph per Step 7 section (label → mainIdea, carrying refs/notes); no groupings. */
  importFromStep7(): void {
    if (!this.canImport()) return;
    this.update(() => ({
      paragraphs: this.structureSections().map((s) => ({ ...s })),
      groupings: [],
    }));
  }

  // --- single mutation entry point (keeps spans valid) ---

  private update(
    fn: (
      paragraphs: OutlineParagraph[],
      groupings: OutlineGrouping[],
    ) => { paragraphs: OutlineParagraph[]; groupings: OutlineGrouping[] },
  ): void {
    const result = fn([...this.paragraphs()], [...this.groupings()]);
    const n = normalize(result.paragraphs, result.groupings);
    this.paragraphs.set(n.paragraphs);
    this.groupings.set(n.groupings);
  }

  // --- save ---

  save(): void {
    // Drop paragraphs with an empty main idea and groupings with an empty title, then re-normalise
    // so every surviving grouping still spans a contiguous run of the surviving paragraphs.
    const keptIndices: number[] = [];
    const paragraphs: OutlineParagraph[] = [];
    this.paragraphs().forEach((p, i) => {
      if (p.mainIdea.trim().length > 0) {
        keptIndices.push(i);
        paragraphs.push(p);
      }
    });
    // Remap old paragraph indices → new positions; a grouping touching a dropped paragraph shrinks.
    const remap = new Map<number, number>();
    keptIndices.forEach((oldIdx, newIdx) => remap.set(oldIdx, newIdx));
    const groupings: OutlineGrouping[] = [];
    for (const g of this.groupings()) {
      if (g.title.trim().length === 0) continue;
      const coveredNew: number[] = [];
      for (let i = g.startIndex; i <= g.endIndex; i++) {
        const mapped = remap.get(i);
        if (mapped !== undefined) coveredNew.push(mapped);
      }
      if (coveredNew.length === 0) continue;
      const startIndex = Math.min(...coveredNew);
      const endIndex = Math.max(...coveredNew);
      // Only keep if still contiguous after the drop (it is, since survivors keep relative order).
      if (endIndex - startIndex === coveredNew.length - 1) {
        groupings.push({ ...g, startIndex, endIndex });
      }
    }

    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.outlineStudy.save(this.scrollStudyId, { paragraphs, groupings }).subscribe({
      next: (savedStudy) => {
        this.saving.set(false);
        this.saved.set(true);
        const n = normalize(savedStudy.paragraphs, savedStudy.groupings);
        this.paragraphs.set(n.paragraphs);
        this.groupings.set(n.groupings);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(true);
      },
    });
  }
}
