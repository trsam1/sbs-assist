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
import { OutlineNode, StructureSection } from '../models';
import { outlineLabels } from '../outline-number';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

/** The deepest nesting level a node may carry (0 = "I", 3 = "a"), matching the Lambda. */
const MAX_LEVEL = 3;

/** Indent width (rem) applied per nesting level so bracketing/grouping is visible. */
const INDENT_REM = 1.5;

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
              Make a provisional outline: list the book's paragraphs, title each one, then bracket
              and group them into divisions. Move nodes up and down to order them, and indent to
              nest. The outline is yours — software only holds the structure and numbers it.
            </p>

            <!-- Import from Step 7 -->
            @if (canImport()) {
              <div class="notification is-link is-light" data-testid="outline-import">
                <p class="mb-2">
                  You have a saved Step 7 structure for this book. Import its sections as your
                  starting outline nodes so you don't re-type them.
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

            <!-- Outline nodes -->
            <div class="box" data-testid="outline-nodes">
              <h3 class="title is-5">Outline</h3>
              @if (nodes().length === 0) {
                <p class="help mb-3" data-testid="outline-empty">
                  No nodes yet. Add one for each paragraph, then title, bracket, and group them.
                </p>
              }
              @for (n of nodes(); track $index; let i = $index) {
                <div
                  class="box p-3 mb-2"
                  data-testid="node-row"
                  [style.margin-left.rem]="n.level * indentRem"
                >
                  <!-- Standard-form label + title + reorder/indent/remove controls -->
                  <div class="field has-addons mb-2">
                    <div class="control">
                      <span class="button is-small is-static" data-testid="node-label">
                        {{ labelAt(i) }}
                      </span>
                    </div>
                    <div class="control is-expanded">
                      <input
                        class="input is-small"
                        type="text"
                        maxlength="200"
                        placeholder="Node title (3–6 words from the topic sentence)"
                        [ngModel]="n.title"
                        (ngModelChange)="setNodeTitle(i, $event)"
                        [attr.aria-label]="'Node ' + (i + 1) + ' title'"
                        data-testid="node-title"
                      />
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="n.level === 0"
                        (click)="outdentNode(i)"
                        [attr.aria-label]="'Outdent node ' + (i + 1)"
                        data-testid="node-outdent"
                      >
                        ⇤
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="n.level === maxLevel"
                        (click)="indentNode(i)"
                        [attr.aria-label]="'Indent node ' + (i + 1)"
                        data-testid="node-indent"
                      >
                        ⇥
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="i === 0"
                        (click)="moveNode(i, -1)"
                        [attr.aria-label]="'Move node ' + (i + 1) + ' up'"
                        data-testid="node-up"
                      >
                        ↑
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="i === nodes().length - 1"
                        (click)="moveNode(i, 1)"
                        [attr.aria-label]="'Move node ' + (i + 1) + ' down'"
                        data-testid="node-down"
                      >
                        ↓
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small is-danger is-outlined"
                        type="button"
                        (click)="removeNode(i)"
                        [attr.aria-label]="'Remove node ' + (i + 1)"
                        data-testid="node-remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <!-- Passage location: where this node starts and stops -->
                  <div class="field is-grouped mb-2">
                    <div class="control is-expanded">
                      <label class="label is-small mb-1" [attr.for]="'node-start-' + i">
                        Starts at
                      </label>
                      <input
                        [id]="'node-start-' + i"
                        class="input is-small"
                        type="text"
                        maxlength="50"
                        placeholder="e.g. 1:1 or “the opening greeting”"
                        [ngModel]="n.startRef"
                        (ngModelChange)="setNodeStartRef(i, $event)"
                        [attr.aria-label]="'Node ' + (i + 1) + ' starts at'"
                        data-testid="node-start"
                      />
                    </div>
                    <div class="control is-expanded">
                      <label class="label is-small mb-1" [attr.for]="'node-end-' + i">
                        Stops at
                      </label>
                      <input
                        [id]="'node-end-' + i"
                        class="input is-small"
                        type="text"
                        maxlength="50"
                        placeholder="e.g. 2:4 or “before the hymn”"
                        [ngModel]="n.endRef"
                        (ngModelChange)="setNodeEndRef(i, $event)"
                        [attr.aria-label]="'Node ' + (i + 1) + ' stops at'"
                        data-testid="node-end"
                      />
                    </div>
                  </div>

                  <!-- Optional per-node notes -->
                  <div class="field">
                    <label class="label is-small mb-1" [attr.for]="'node-notes-' + i">Notes</label>
                    <textarea
                      [id]="'node-notes-' + i"
                      class="textarea is-small"
                      rows="2"
                      maxlength="1000"
                      placeholder="Why these paragraphs belong together — the flow of thought"
                      [ngModel]="n.notes"
                      (ngModelChange)="setNodeNotes(i, $event)"
                      [attr.aria-label]="'Node ' + (i + 1) + ' notes'"
                      data-testid="node-notes"
                    ></textarea>
                  </div>
                </div>
              }
              <button
                class="button is-small"
                type="button"
                (click)="addNode()"
                data-testid="node-add"
              >
                Add node
              </button>
            </div>

            <!-- Standard outline form (derived) -->
            @if (nodes().length > 0) {
              <div class="box" data-testid="outline-standard-form">
                <h3 class="title is-5">Standard outline form</h3>
                <ul class="outline-standard">
                  @for (row of labels(); track row.index) {
                    <li data-testid="standard-row" [style.margin-left.rem]="row.level * indentRem">
                      <strong>{{ row.label }}.</strong> {{ nodes()[row.index].title }}
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
})
export class OutlineViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly outlineStudy = inject(OutlineStudyService);
  private readonly structureStudy = inject(StructureStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);

  // Persisted worksheet
  readonly nodes = signal<OutlineNode[]>([]);

  // Step 7 seed (for the import affordance)
  private readonly structureSections = signal<StructureSection[]>([]);

  // Derived standard-form labels (not persisted)
  readonly labels = computed(() => outlineLabels(this.nodes()));

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  readonly maxLevel = MAX_LEVEL;
  readonly indentRem = INDENT_REM;

  /** Import is offered only when a Step 7 structure has sections AND the outline is still empty. */
  readonly canImport = computed(
    () => this.structureSections().length > 0 && this.nodes().length === 0,
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
          // uploading | extracting
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
        this.nodes.set(saved.nodes);
      },
      error: () => {
        // 404 (no saved study) or a transient error: leave the empty editable worksheet in place.
      },
    });
    this.structureStudy.get(this.scrollStudyId).subscribe({
      next: (struct) => {
        this.structureSections.set(struct.sections);
      },
      error: () => {
        // 404 (no Step 7 structure): no import affordance; build from scratch.
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

  /** The standard-form label for the node at `index`, from the derived labels. */
  labelAt(index: number): string {
    return this.labels()[index]?.label ?? '';
  }

  // --- nodes ---

  addNode(): void {
    this.nodes.update((n) => {
      const level = n.length > 0 ? n[n.length - 1].level : 0;
      return [...n, { title: '', level, startRef: '', endRef: '', notes: '' }];
    });
  }

  setNodeTitle(index: number, title: string): void {
    this.nodes.update((n) => n.map((node, i) => (i === index ? { ...node, title } : node)));
  }

  setNodeStartRef(index: number, startRef: string): void {
    this.nodes.update((n) => n.map((node, i) => (i === index ? { ...node, startRef } : node)));
  }

  setNodeEndRef(index: number, endRef: string): void {
    this.nodes.update((n) => n.map((node, i) => (i === index ? { ...node, endRef } : node)));
  }

  setNodeNotes(index: number, notes: string): void {
    this.nodes.update((n) => n.map((node, i) => (i === index ? { ...node, notes } : node)));
  }

  removeNode(index: number): void {
    this.nodes.update((n) => n.filter((_, i) => i !== index));
  }

  moveNode(index: number, delta: number): void {
    const target = index + delta;
    this.nodes.update((n) => {
      if (target < 0 || target >= n.length) {
        return n;
      }
      const next = [...n];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  indentNode(index: number): void {
    this.nodes.update((n) =>
      n.map((node, i) =>
        i === index ? { ...node, level: Math.min(MAX_LEVEL, node.level + 1) } : node,
      ),
    );
  }

  outdentNode(index: number): void {
    this.nodes.update((n) =>
      n.map((node, i) => (i === index ? { ...node, level: Math.max(0, node.level - 1) } : node)),
    );
  }

  // --- seed from Step 7 ---

  /** Create one level-0 node per Step 7 section, carrying label → title and the refs/notes. */
  importFromStep7(): void {
    if (!this.canImport()) {
      return;
    }
    const imported: OutlineNode[] = this.structureSections().map((s) => ({
      title: s.label,
      level: 0,
      startRef: s.startRef,
      endRef: s.endRef,
      notes: s.notes,
    }));
    this.nodes.set(imported);
  }

  // --- save ---

  save(): void {
    // Drop nodes the student left with an empty title before persisting.
    const nodes = this.nodes().filter((n) => n.title.trim().length > 0);
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.outlineStudy.save(this.scrollStudyId, { nodes }).subscribe({
      next: (savedStudy) => {
        this.saving.set(false);
        this.saved.set(true);
        // Reflect the server-normalised worksheet (e.g. dropped empty-title nodes).
        this.nodes.set(savedStudy.nodes);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(true);
      },
    });
  }
}
