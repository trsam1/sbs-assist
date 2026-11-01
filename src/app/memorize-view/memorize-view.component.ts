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
import { MemorizationStudyService } from '../memorization-study.service';
import { OutlineStudyService } from '../outline-study.service';
import { MemorizationChunk, MemorizationChunkState, OutlineParagraph } from '../models';
import {
  seedByVerses,
  seedFromParagraphs,
  findVerseMarkers,
  chunkText,
  chunkOutOfRange,
  firstLetters,
  blankEveryNth,
  clozeMatches,
  ClozeToken,
  VERSE_REF_MAX,
  DEFAULT_VERSES_PER_CHUNK,
  VERSES_PER_CHUNK_MIN,
  VERSES_PER_CHUNK_MAX,
} from './chunking';

type ViewState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';
type DrillMode = 'chain' | 'reveal' | 'cloze';
type RevealLevel = 'full' | 'first' | 'blank';

const STATE_LABELS: Record<MemorizationChunkState, string> = {
  new: 'New',
  learning: 'Learning',
  chained: 'Chained',
  solid: 'Solid',
};
const STATE_ORDER: MemorizationChunkState[] = ['new', 'learning', 'chained', 'solid'];

@Component({
  selector: 'app-memorize-view',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Memorize the scroll">
      <div class="container">
        @if (study(); as s) {
          <h2 class="title is-4" data-testid="memorize-book">{{ s.bookName }} — Memorize</h2>
        }

        @switch (state()) {
          @case ('loading') {
            <div class="has-text-centered py-5" aria-live="polite" aria-busy="true">
              <p>Loading…</p>
            </div>
          }
          @case ('ready') {
            <p class="mb-4">
              Memorize the book from your own scroll. Seed chunks either by a verse count (learn N
              verses at a time) or from your Step 8 paragraphs, then drill chunk by chunk — chaining
              each onto the run, revealing progressively, or filling the blanks. Verse references
              are kept as labels. Your progress is saved.
            </p>

            <!-- Progress summary + chunking controls -->
            <div class="box">
              <div class="level is-mobile mb-3">
                <div class="level-left">
                  <p class="is-size-6" data-testid="memorize-progress">{{ progressLabel() }}</p>
                </div>
              </div>

              <!-- Seed methods -->
              <div class="field is-grouped is-align-items-end mb-3" data-testid="seed-controls">
                <div class="control">
                  <label class="label is-small mb-1" for="verses-per-chunk">Verses per chunk</label>
                  <input
                    id="verses-per-chunk"
                    class="input is-small"
                    type="number"
                    [min]="VERSES_PER_CHUNK_MIN"
                    [max]="VERSES_PER_CHUNK_MAX"
                    [ngModel]="versesPerChunk()"
                    (ngModelChange)="setVersesPerChunk(+$event)"
                    data-testid="verses-per-chunk"
                    style="width: 6rem"
                  />
                </div>
                <div class="control">
                  <button
                    class="button is-small"
                    type="button"
                    [disabled]="!hasVerseMarkers()"
                    (click)="seedByVerseCount()"
                    data-testid="seed-by-verses"
                  >
                    {{ chunks().length === 0 ? 'Seed by verses' : 'Re-seed by verses' }}
                  </button>
                </div>
                @if (outlineParagraphs().length > 0) {
                  <div class="control">
                    <button
                      class="button is-small"
                      type="button"
                      (click)="seedFromOutline()"
                      data-testid="seed-from-step8"
                    >
                      {{
                        chunks().length === 0
                          ? 'Seed from Step 8 paragraphs'
                          : 'Re-seed from Step 8'
                      }}
                    </button>
                  </div>
                }
              </div>

              @if (!hasVerseMarkers() && outlineParagraphs().length === 0) {
                <div
                  class="notification is-warning is-light"
                  role="status"
                  data-testid="seed-blocked"
                >
                  This scroll has no verse markers and no Step 8 outline yet, so chunks can't be
                  seeded. Add verse references to your scroll text, or complete Step 8 (Outline),
                  then come back.
                </div>
              } @else if (chunks().length === 0) {
                <div role="status" data-testid="memorize-empty">
                  No chunks yet. Seed by a verse count, or from your Step 8 paragraphs, then adjust
                  the boundaries.
                </div>
              }

              @if (seedUnmapped().length > 0) {
                <div
                  class="notification is-warning is-light"
                  role="alert"
                  data-testid="seed-unmapped"
                >
                  {{ seedUnmapped().length }} Step 8 paragraph(s) referenced a location not found in
                  the scroll text and were skipped. Check those paragraphs' references, or adjust
                  the chunks below by hand.
                </div>
              }

              <!-- Chunk editor -->
              @for (chunk of chunks(); track $index) {
                <div class="box p-3 mb-2" data-testid="memorize-chunk-row">
                  <div class="field is-grouped is-align-items-end mb-2">
                    <div class="control">
                      <label class="label is-small mb-1" [attr.for]="'verseref-' + $index"
                        >Reference (label only)</label
                      >
                      <input
                        [id]="'verseref-' + $index"
                        class="input is-small"
                        type="text"
                        [maxlength]="VERSE_REF_MAX"
                        placeholder="e.g. 2:5-8"
                        [ngModel]="chunk.verseRef"
                        (ngModelChange)="setVerseRef($index, $event)"
                        data-testid="chunk-verseref"
                      />
                    </div>
                    <div class="control">
                      <label class="label is-small mb-1" [attr.for]="'state-' + $index"
                        >Progress</label
                      >
                      <div class="select is-small">
                        <select
                          [id]="'state-' + $index"
                          [ngModel]="chunk.state"
                          (ngModelChange)="setState($index, $event)"
                          data-testid="chunk-state"
                        >
                          @for (st of stateOrder; track st) {
                            <option [value]="st">{{ stateLabels[st] }}</option>
                          }
                        </select>
                      </div>
                    </div>
                    <div class="control is-expanded"></div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="$index === 0"
                        (click)="moveUp($index)"
                        [attr.aria-label]="'Move chunk ' + ($index + 1) + ' up'"
                        data-testid="chunk-reorder"
                      >
                        ↑
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small"
                        type="button"
                        [disabled]="$index === 0"
                        (click)="mergeUp($index)"
                        [attr.aria-label]="'Merge chunk ' + ($index + 1) + ' into the one above'"
                        data-testid="chunk-merge"
                      >
                        Merge up
                      </button>
                    </div>
                    <div class="control">
                      <button
                        class="button is-small is-danger is-outlined"
                        type="button"
                        (click)="removeChunk($index)"
                        [attr.aria-label]="'Remove chunk ' + ($index + 1)"
                        data-testid="chunk-remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  @if (chunk.verseRef) {
                    <span class="tag is-light is-small mr-2" aria-label="Reference">{{
                      chunk.verseRef
                    }}</span>
                  }
                  @if (outOfRange($index)) {
                    <p class="help is-warning" role="alert" data-testid="chunk-out-of-range">
                      This chunk's range no longer fits the scroll text — re-seed to fix it.
                    </p>
                  }
                  <p class="is-size-7 has-text-grey" data-testid="chunk-preview">
                    {{ preview($index) }}
                  </p>
                </div>
              }
            </div>

            <!-- Drill surface -->
            @if (chunks().length > 0) {
              <div class="box" data-testid="memorize-drill">
                <h3 class="title is-5">Drill</h3>
                <div class="buttons has-addons are-small" role="group" aria-label="Drill mode">
                  <button
                    type="button"
                    class="button"
                    [class.is-link]="mode() === 'chain'"
                    [attr.aria-pressed]="mode() === 'chain'"
                    (click)="setMode('chain')"
                    data-testid="drill-mode-chain"
                  >
                    Chain
                  </button>
                  <button
                    type="button"
                    class="button"
                    [class.is-link]="mode() === 'reveal'"
                    [attr.aria-pressed]="mode() === 'reveal'"
                    (click)="setMode('reveal')"
                    data-testid="drill-mode-reveal"
                  >
                    Reveal
                  </button>
                  <button
                    type="button"
                    class="button"
                    [class.is-link]="mode() === 'cloze'"
                    [attr.aria-pressed]="mode() === 'cloze'"
                    (click)="setMode('cloze')"
                    data-testid="drill-mode-cloze"
                  >
                    Fill blanks
                  </button>
                </div>

                <!-- Chunk selector -->
                <div class="field">
                  <label class="label is-small mb-1" for="active-chunk">Chunk</label>
                  <div class="select is-small">
                    <select
                      id="active-chunk"
                      [ngModel]="activeIndex()"
                      (ngModelChange)="setActive(+$event)"
                      data-testid="active-chunk"
                    >
                      @for (chunk of chunks(); track $index) {
                        <option [value]="$index">
                          {{ $index + 1 }}{{ chunk.verseRef ? ' — ' + chunk.verseRef : '' }}
                        </option>
                      }
                    </select>
                  </div>
                </div>

                @switch (mode()) {
                  @case ('chain') {
                    <p class="help mb-2">
                      Recite this chunk, then recite the whole run chained from the first learned
                      chunk.
                    </p>
                    <div class="content" data-testid="chain-active">{{ activeText() }}</div>
                    <h4 class="title is-6">Chained run</h4>
                    <div class="content" data-testid="chain-run">{{ chainRun() }}</div>
                  }
                  @case ('reveal') {
                    <div class="buttons are-small">
                      <button
                        class="button"
                        [class.is-link]="revealLevel() === 'full'"
                        type="button"
                        (click)="setReveal('full')"
                        data-testid="reveal-full"
                      >
                        Full
                      </button>
                      <button
                        class="button"
                        [class.is-link]="revealLevel() === 'first'"
                        type="button"
                        (click)="setReveal('first')"
                        data-testid="reveal-first"
                      >
                        First letters
                      </button>
                      <button
                        class="button"
                        [class.is-link]="revealLevel() === 'blank'"
                        type="button"
                        (click)="setReveal('blank')"
                        data-testid="reveal-blank"
                      >
                        Blank
                      </button>
                    </div>
                    <div class="content" data-testid="reveal-text">{{ revealText() }}</div>
                  }
                  @case ('cloze') {
                    <div class="field is-grouped is-align-items-center mb-3">
                      <div class="control">
                        <label class="label is-small mb-0 mr-2" for="cloze-n">Hide every</label>
                      </div>
                      <div class="control">
                        <input
                          id="cloze-n"
                          class="input is-small"
                          type="number"
                          min="2"
                          max="10"
                          [ngModel]="clozeN()"
                          (ngModelChange)="setClozeN(+$event)"
                          data-testid="cloze-n"
                          style="width: 5rem"
                        />
                      </div>
                      <div class="control"><span class="is-size-7">word(s)</span></div>
                      <div class="control">
                        <button
                          class="button is-small"
                          type="button"
                          (click)="toggleClozeReveal()"
                          data-testid="cloze-reveal-toggle"
                        >
                          {{ clozeRevealed() ? 'Hide answers' : 'Reveal answers' }}
                        </button>
                      </div>
                    </div>
                    <div class="content" data-testid="cloze-tokens">
                      @for (tok of clozeTokens(); track $index) {
                        @if (tok.blank) {
                          <span
                            class="tag is-light"
                            [class.is-success]="clozeResult()[$index] === true"
                            [class.is-danger]="clozeResult()[$index] === false"
                            data-testid="cloze-slot"
                          >
                            @if (clozeRevealed()) {
                              {{ tok.text }}
                            } @else {
                              <input
                                class="input is-small"
                                type="text"
                                [ngModel]="clozeTyped()[$index] ?? ''"
                                (ngModelChange)="setClozeTyped($index, $event)"
                                [attr.aria-label]="'Blank ' + ($index + 1)"
                                data-testid="cloze-input"
                                style="width: 6rem"
                              />
                            }
                          </span>
                        } @else {
                          <span>{{ tok.text }}</span>
                        }
                      }
                    </div>
                    <button
                      class="button is-small"
                      type="button"
                      (click)="checkCloze()"
                      data-testid="cloze-check"
                    >
                      Check
                    </button>
                  }
                }
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
                data-testid="memorize-save"
              >
                Save
              </button>
            </div>
            <div aria-live="polite">
              @if (saved()) {
                <p class="has-text-success" data-testid="memorize-saved">Saved.</p>
              }
              @if (saveError()) {
                <p class="has-text-danger" data-testid="memorize-save-error">
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
              data-testid="memorize-preparing"
            >
              <p>
                The scroll text is still being prepared. Open the scroll view to wait for it to
                finish, then come back.
              </p>
              <a
                [routerLink]="['/scroll', scrollStudyId]"
                class="button is-info is-outlined is-small mt-2"
                data-testid="memorize-preparing-back"
              >
                Back to scroll
              </a>
            </div>
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="memorize-failed">
              <p>{{ failedMessage() }}</p>
              <a
                routerLink="/scrolls"
                class="button is-danger is-outlined is-small mt-2"
                data-testid="memorize-failed-back"
              >
                Back to scroll list
              </a>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="memorize-error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="load()"
                data-testid="memorize-retry-button"
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
export class MemorizeViewComponent implements OnInit {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly memorizationStudy = inject(MemorizationStudyService);
  private readonly outlineStudy = inject(OutlineStudyService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);

  readonly chunks = signal<MemorizationChunk[]>([]);

  // Seed state.
  readonly versesPerChunk = signal(DEFAULT_VERSES_PER_CHUNK);
  readonly outlineParagraphs = signal<OutlineParagraph[]>([]);
  readonly seedUnmapped = signal<number[]>([]);

  // Drill UI state (view-only, not persisted).
  readonly mode = signal<DrillMode>('chain');
  readonly activeIndex = signal(0);
  readonly revealLevel = signal<RevealLevel>('full');
  readonly clozeN = signal(3);
  readonly clozeRevealed = signal(false);
  readonly clozeTyped = signal<Record<number, string>>({});
  readonly clozeResult = signal<Record<number, boolean>>({});

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal(false);

  protected readonly VERSE_REF_MAX = VERSE_REF_MAX;
  protected readonly VERSES_PER_CHUNK_MIN = VERSES_PER_CHUNK_MIN;
  protected readonly VERSES_PER_CHUNK_MAX = VERSES_PER_CHUNK_MAX;
  protected readonly stateLabels = STATE_LABELS;
  protected readonly stateOrder = STATE_ORDER;

  scrollStudyId = '';

  private scrollText(): string {
    return this.study()?.scrollText ?? '';
  }

  /** True when the scroll carries at least one verse marker (enables the by-verses seed). */
  readonly hasVerseMarkers = computed(() => findVerseMarkers(this.scrollText()).length > 0);

  readonly progressLabel = computed(() => {
    const cs = this.chunks();
    const solid = cs.filter((c) => c.state === 'solid').length;
    return `${solid} of ${cs.length} chunks solid`;
  });

  readonly activeText = computed(() => {
    const cs = this.chunks();
    const i = this.activeIndex();
    if (i < 0 || i >= cs.length) return '';
    return chunkText(this.scrollText(), cs[i]);
  });

  /** The accumulated run: chunks 0..activeIndex joined in order (chain-and-chain). */
  readonly chainRun = computed(() => {
    const cs = this.chunks();
    const i = Math.min(this.activeIndex(), cs.length - 1);
    const text = this.scrollText();
    return cs
      .slice(0, i + 1)
      .map((c) => chunkText(text, c))
      .join('\n');
  });

  readonly revealText = computed(() => {
    const text = this.activeText();
    switch (this.revealLevel()) {
      case 'full':
        return text;
      case 'first':
        return firstLetters(text);
      case 'blank':
        return firstLetters(text).replace(/[^\s_]/g, '_');
    }
  });

  readonly clozeTokens = computed<ClozeToken[]>(() =>
    blankEveryNth(this.activeText(), this.clozeN()),
  );

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
          this.loadOutline();
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

  /** Fetch the saved study (if any). A 404 means "none yet" → empty worksheet with a seed action. */
  private loadSaved(): void {
    this.memorizationStudy.get(this.scrollStudyId).subscribe({
      next: (saved) => {
        this.chunks.set(saved.chunks);
      },
      error: () => {
        // 404 (none yet) or transient: leave the empty worksheet in place.
      },
    });
  }

  /** Fetch the Step 8 outline (if any) so the "seed from paragraphs" action can be offered. */
  private loadOutline(): void {
    this.outlineStudy.get(this.scrollStudyId).subscribe({
      next: (outline) => {
        this.outlineParagraphs.set(outline.paragraphs ?? []);
      },
      error: () => {
        // 404 (no outline yet) or transient: leave paragraphs empty → Step 8 seed not offered.
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

  // --- chunk editing ---

  setVersesPerChunk(n: number): void {
    this.versesPerChunk.set(
      Math.max(
        VERSES_PER_CHUNK_MIN,
        Math.min(VERSES_PER_CHUNK_MAX, Math.floor(n || DEFAULT_VERSES_PER_CHUNK)),
      ),
    );
  }

  /** Seed by grouping every N verse markers into a chunk. No-op if the scroll has no markers. */
  seedByVerseCount(): void {
    const seeded = seedByVerses(this.scrollText(), this.versesPerChunk());
    this.chunks.set(seeded);
    this.seedUnmapped.set([]);
    this.activeIndex.set(0);
  }

  /** Seed one chunk per Step 8 paragraph, mapping each paragraph's refs to scroll offsets. */
  seedFromOutline(): void {
    const { chunks, unmapped } = seedFromParagraphs(this.scrollText(), this.outlineParagraphs());
    this.chunks.set(chunks);
    this.seedUnmapped.set(unmapped);
    this.activeIndex.set(0);
  }

  removeChunk(index: number): void {
    this.chunks.update((cs) => cs.filter((_, i) => i !== index));
    this.clampActive();
  }

  moveUp(index: number): void {
    if (index <= 0) return;
    this.chunks.update((cs) => {
      const next = [...cs];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  /** Merge a chunk into the one above it (union of ranges; keeps the upper chunk's label/state). */
  mergeUp(index: number): void {
    if (index <= 0) return;
    this.chunks.update((cs) => {
      const next = [...cs];
      const above = next[index - 1];
      const here = next[index];
      next[index - 1] = {
        ...above,
        start: Math.min(above.start, here.start),
        end: Math.max(above.end, here.end),
      };
      next.splice(index, 1);
      return next;
    });
    this.clampActive();
  }

  setVerseRef(index: number, value: string): void {
    this.chunks.update((cs) => cs.map((c, i) => (i === index ? { ...c, verseRef: value } : c)));
  }

  setState(index: number, value: MemorizationChunkState): void {
    this.chunks.update((cs) => cs.map((c, i) => (i === index ? { ...c, state: value } : c)));
  }

  preview(index: number): string {
    const text = chunkText(this.scrollText(), this.chunks()[index]);
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
  }

  outOfRange(index: number): boolean {
    return chunkOutOfRange(this.scrollText(), this.chunks()[index]);
  }

  private clampActive(): void {
    const len = this.chunks().length;
    if (this.activeIndex() >= len) this.activeIndex.set(Math.max(0, len - 1));
  }

  // --- drill controls (view-only) ---

  setMode(mode: DrillMode): void {
    this.mode.set(mode);
  }

  setActive(index: number): void {
    this.activeIndex.set(index);
    this.clozeTyped.set({});
    this.clozeResult.set({});
    this.clozeRevealed.set(false);
  }

  setReveal(level: RevealLevel): void {
    this.revealLevel.set(level);
  }

  setClozeN(n: number): void {
    this.clozeN.set(Math.max(2, Math.min(10, Math.floor(n || 2))));
    this.clozeResult.set({});
  }

  toggleClozeReveal(): void {
    this.clozeRevealed.update((r) => !r);
  }

  setClozeTyped(index: number, value: string): void {
    this.clozeTyped.update((t) => ({ ...t, [index]: value }));
  }

  checkCloze(): void {
    const tokens = this.clozeTokens();
    const typed = this.clozeTyped();
    const result: Record<number, boolean> = {};
    tokens.forEach((tok, i) => {
      if (tok.blank) result[i] = clozeMatches(typed[i] ?? '', tok.text);
    });
    this.clozeResult.set(result);
  }

  // --- save ---

  save(): void {
    const chunks = this.chunks();
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.memorizationStudy.save(this.scrollStudyId, { chunks }).subscribe({
      next: (savedStudy) => {
        this.saving.set(false);
        this.saved.set(true);
        this.chunks.set(savedStudy.chunks);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(true);
      },
    });
  }
}
