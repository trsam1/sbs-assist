import { inject, Injectable, signal } from '@angular/core';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';

export type ScrollToolState = 'loading' | 'ready' | 'preparing' | 'failed' | 'error';

/**
 * Loads one scroll study for a tool page and exposes the same state machine every scroll-based page
 * used to re-implement. Provide it per page (`providers: [ScrollToolContext]`).
 */
@Injectable()
export class ScrollToolContext {
  private readonly scrollStudyService = inject(ScrollStudyService);

  readonly study = signal<ScrollStudy | null>(null);
  readonly state = signal<ScrollToolState>('loading');

  private scrollStudyId = '';
  private onStart: (() => void) | undefined;
  private onReady: ((study: ScrollStudy) => void) | undefined;

  /**
   * Start (or restart) the load. `onStart` runs before each load and is where a page resets its own
   * transient flags; `onReady` runs once the scroll is ready and is where a page derives its data and
   * fetches its saved study.
   */
  load(
    scrollStudyId: string,
    hooks: { onStart?: () => void; onReady?: (study: ScrollStudy) => void } = {},
  ): void {
    this.scrollStudyId = scrollStudyId;
    this.onStart = hooks.onStart;
    this.onReady = hooks.onReady;
    this.run();
  }

  /** Reload with the same id and hooks (the error panel's Retry button). */
  retry(): void {
    this.run();
  }

  /** Why a scroll that is not ready cannot be used. */
  failedMessage(): string {
    const s = this.study();
    if (s?.status === 'failed') {
      return s.failureReason || 'This scroll could not be prepared.';
    }
    return 'This scroll could not be found.';
  }

  private run(): void {
    this.state.set('loading');
    this.onStart?.();
    this.scrollStudyService.getScrollStudy(this.scrollStudyId).subscribe({
      next: (s) => {
        this.study.set(s);
        if (s.status === 'ready') {
          this.onReady?.(s);
          this.state.set('ready');
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
}
