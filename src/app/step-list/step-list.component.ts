import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COMPANION_TOOLS, STEPS, StepDef, stepLabel, stepLink } from '../steps';
import { StepStatus } from './step-status.service';

/**
 * The method's steps as a list, built from the step catalog: each shipped step links to its page once the
 * scroll is ready; other steps show their software fit. Used by Book home and the scroll page.
 */
@Component({
  selector: 'app-step-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="step-list" data-testid="step-links">
      @for (s of rows; track s.id) {
        <li
          class="is-flex is-align-items-center is-justify-content-space-between py-2"
          [attr.data-testid]="'step-row-' + s.id"
        >
          <span>
            @if (s.fit === 'manual') {
              <span class="has-text-grey">{{ label(s) }}</span>
              <span class="tag is-light ml-2">Pencil and paper</span>
            } @else if (s.fit === 'candidate' || s.fit === 'planned') {
              <span class="has-text-grey">{{ label(s) }}</span>
              <span class="tag is-light ml-2">{{
                s.fit === 'planned' ? 'Planned' : 'Not built yet'
              }}</span>
            } @else {
              <strong>{{ label(s) }}</strong>
              @if (statusOf(s.id); as st) {
                <span
                  class="tag ml-2"
                  [class.is-info]="st === 'in-progress'"
                  [class.is-light]="st !== 'in-progress'"
                  [attr.data-testid]="'step-status-' + s.id"
                  >{{ statusText(st) }}</span
                >
              }
              @if (s.id === 'memorize' && memorizeDue() !== null) {
                <span class="tag is-warning is-light ml-2" data-testid="memorize-due"
                  >{{ memorizeDue() }} due</span
                >
              }
            }
            <span class="is-block is-size-7 has-text-grey">{{ s.blurb }}</span>
          </span>

          @if (s.fit === 'shipped') {
            @if (s.id === 'word-study') {
              <a
                class="button is-small is-link is-outlined"
                routerLink="/studies"
                data-testid="word-studies-link"
                >Word studies</a
              >
            } @else if (s.route !== null && scrollStudyId() && (!s.needsScroll || scrollReady())) {
              <a
                class="button is-small is-link is-outlined"
                [class.is-primary]="s.id === 'memorize'"
                [routerLink]="linkFor(s)"
                [fragment]="s.fragment"
                [attr.data-testid]="testIdFor(s)"
                >{{ s.id === 'scroll' ? 'Open scroll' : 'Open' }}</a
              >
            }
          }
        </li>
      }
    </ul>
    @if (!scrollReady()) {
      <p class="is-size-7 has-text-grey" data-testid="steps-pending">
        Steps 6–12 and Memorize become available once the scroll finishes processing.
      </p>
    }
  `,
})
export class StepListComponent {
  readonly scrollStudyId = input.required<string>();
  readonly scrollReady = input<boolean>(false);
  readonly statuses = input<Record<string, StepStatus>>({});
  readonly memorizeDue = input<number | null>(null);

  readonly rows: readonly StepDef[] = [...STEPS, ...COMPANION_TOOLS];

  private readonly byId = computed(() => this.statuses());

  label(s: StepDef): string {
    return stepLabel(s);
  }

  statusOf(id: string): StepStatus | null {
    return this.byId()[id] ?? null;
  }

  statusText(st: StepStatus): string {
    return st === 'in-progress' ? 'In progress' : st === 'not-started' ? 'Not started' : '—';
  }

  linkFor(s: StepDef): string[] {
    return stepLink(s, this.scrollStudyId());
  }

  testIdFor(s: StepDef): string {
    if (s.id === 'scroll') return 'open-scroll-link';
    if (s.id === 'theme') return 'theme-purpose-link';
    return `${s.id}-link`;
  }
}
