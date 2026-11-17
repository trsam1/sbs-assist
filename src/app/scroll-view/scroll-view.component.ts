import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ScrollStudy, ScrollStudyService, ScrollStatus } from '../scroll-study.service';
import { StepListComponent } from '../step-list/step-list.component';
import { StepStatus, StepStatusService } from '../step-list/step-status.service';

type ViewState = 'loading' | 'processing' | 'ready' | 'failed' | 'timeout' | 'error';

/** Poll interval and bounded attempt count (≈ 60s, matching the extractor timeout). */
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20;

@Component({
  selector: 'app-scroll-view',
  imports: [RouterLink, StepListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" aria-label="Scroll study">
      <div class="container">
        @if (study(); as s) {
          @if (s.bookStudyId) {
            <a
              [routerLink]="['/books', s.bookStudyId]"
              class="button is-light is-small mb-4"
              data-testid="back-to-book-link"
            >
              ← Back to book study
            </a>
          }
          <h2 class="title is-4" data-testid="scroll-book">{{ s.bookName }}</h2>
        }

        @switch (state()) {
          @case ('loading') {
            <div class="has-text-centered py-5" aria-live="polite" aria-busy="true">
              <p>Loading…</p>
            </div>
          }
          @case ('processing') {
            <div
              class="notification is-info"
              role="status"
              aria-live="polite"
              data-testid="processing"
            >
              <p>Processing your document… this may take a few moments.</p>
            </div>
          }
          @case ('ready') {
            @if (study()?.truncated) {
              <div class="notification is-warning" role="status" data-testid="truncation-notice">
                This text was long and has been truncated.
              </div>
            }
            <div class="box scroll-text-box" data-testid="scroll-text">
              <pre class="scroll-text">{{ study()?.scrollText }}</pre>
            </div>
            <h3 class="title is-5 mt-4">Study steps</h3>
            <app-step-list
              [scrollStudyId]="scrollStudyId"
              [scrollReady]="true"
              [statuses]="stepStatuses()"
              [memorizeDue]="memorizeDue()"
            />
          }
          @case ('failed') {
            <div class="notification is-danger" role="alert" data-testid="failed">
              <p>{{ study()?.failureReason || 'Extraction failed.' }}</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="reupload()"
                data-testid="reupload-button"
              >
                Upload another document
              </button>
            </div>
          }
          @case ('timeout') {
            <div class="notification is-warning" role="alert" data-testid="timeout">
              <p>This is taking longer than expected. You can re-upload the document.</p>
              <button
                class="button is-warning is-outlined is-small mt-2"
                (click)="reupload()"
                data-testid="reupload-button"
              >
                Upload another document
              </button>
            </div>
          }
          @case ('error') {
            <div class="notification is-danger" role="alert" data-testid="error">
              <p>Could not load this scroll study.</p>
              <button
                class="button is-danger is-outlined is-small mt-2"
                (click)="reload()"
                data-testid="retry-button"
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
      .scroll-text-box {
        max-height: 60vh;
        overflow-y: auto;
      }
      .scroll-text {
        white-space: pre-wrap;
        background: transparent;
        padding: 0;
      }
    `,
  ],
})
export class ScrollViewComponent implements OnInit, OnDestroy {
  private readonly scrollStudy = inject(ScrollStudyService);
  private readonly stepStatusService = inject(StepStatusService);
  readonly stepStatuses = signal<Record<string, StepStatus>>({});
  readonly memorizeDue = signal<number | null>(null);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly state = signal<ViewState>('loading');
  readonly study = signal<ScrollStudy | null>(null);

  scrollStudyId = '';
  private polls = 0;
  private pollSub?: Subscription;

  ngOnInit(): void {
    this.scrollStudyId = this.route.snapshot.paramMap.get('scrollStudyId') ?? '';
    this.reload();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  reload(): void {
    this.polls = 0;
    this.stopPolling();
    this.state.set('loading');
    this.fetch();
  }

  private fetch(): void {
    this.scrollStudy.getScrollStudy(this.scrollStudyId).subscribe({
      next: (s) => {
        this.study.set(s);
        this.applyStatus(s.status);
      },
      error: () => {
        this.stopPolling();
        this.state.set('error');
      },
    });
  }

  private applyStatus(status: ScrollStatus): void {
    if (status === 'ready') {
      this.stopPolling();
      const wasReady = this.state() === 'ready';
      this.state.set('ready');
      if (!wasReady) this.loadStepStatuses();
      return;
    }
    if (status === 'failed') {
      this.stopPolling();
      this.state.set('failed');
      return;
    }
    // uploading | extracting → keep polling until terminal or bounded timeout.
    this.state.set('processing');
    this.schedulePoll();
  }

  /** Non-blocking: the step list renders at once and statuses fill in; a failure leaves them blank. */
  private loadStepStatuses(): void {
    this.stepStatusService.load(this.scrollStudyId).subscribe({
      next: (r) => {
        this.stepStatuses.set(r.statuses);
        this.memorizeDue.set(r.memorizeDue);
      },
      error: () => this.stepStatuses.set({}),
    });
  }

  private schedulePoll(): void {
    if (this.polls >= MAX_POLLS) {
      this.stopPolling();
      this.state.set('timeout');
      return;
    }
    this.stopPolling();
    this.pollSub = timer(POLL_INTERVAL_MS).subscribe(() => {
      this.polls += 1;
      this.fetch();
    });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  reupload(): void {
    this.router.navigate(['/scroll/new']);
  }
}
