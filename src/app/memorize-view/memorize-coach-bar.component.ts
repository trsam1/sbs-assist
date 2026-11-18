import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MemorizeCoach } from './memorize-coach';

/**
 * The coaching bar: what the coach is doing in words, with large Pause / Repeat / Skip / Stop buttons so it
 * can be operated at a glance. Shown only while a session is running; fixed to the bottom of the screen.
 */
@Component({
  selector: 'app-memorize-coach-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (coach.mode() !== 'off') {
      <div class="coach-bar" role="region" aria-label="Audio coach" data-testid="coach-bar">
        <div class="coach-text" aria-live="polite">
          <p class="coach-label" data-testid="coach-label">
            {{ coach.paused() ? 'Paused. ' : '' }}{{ coach.label() }}
          </p>
          @if (coach.progress()) {
            <p class="coach-progress" data-testid="coach-progress">{{ coach.progress() }}</p>
          }
          @if (coach.notice()) {
            <p class="coach-notice" role="alert" data-testid="coach-notice">{{ coach.notice() }}</p>
          }
        </div>
        <div class="coach-buttons">
          @if (coach.paused()) {
            <button
              type="button"
              class="button is-link"
              (click)="coach.resume()"
              data-testid="coach-resume"
            >
              Resume
            </button>
          } @else {
            <button
              type="button"
              class="button is-link is-light"
              (click)="coach.pause()"
              data-testid="coach-pause"
            >
              Pause
            </button>
          }
          <button type="button" class="button" (click)="coach.repeat()" data-testid="coach-repeat">
            Repeat
          </button>
          <button type="button" class="button" (click)="coach.skip()" data-testid="coach-skip">
            Skip
          </button>
          @if (coach.mode() === 'test') {
            <button
              type="button"
              class="button"
              (click)="coach.hearIt()"
              data-testid="coach-hear-it"
            >
              Hear it
            </button>
          }
          <button
            type="button"
            class="button is-danger"
            (click)="coach.stop()"
            data-testid="coach-stop"
          >
            Stop
          </button>
        </div>
      </div>
    } @else if (coach.notice()) {
      <p class="notification is-info is-light" role="status" data-testid="coach-notice-idle">
        {{ coach.notice() }}
      </p>
    }
  `,
  styles: [
    `
      .coach-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 30;
        padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
        background: var(--bulma-scheme-main, #fff);
        color: var(--bulma-text, #363636);
        border-top: 2px solid var(--bulma-link, #485fc7);
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
      }
      .coach-label {
        font-size: 1.25rem;
        font-weight: 600;
        line-height: 1.3;
      }
      .coach-progress {
        font-size: 0.85rem;
        opacity: 0.8;
      }
      .coach-notice {
        margin-top: 0.25rem;
        color: var(--bulma-danger, #f14668);
      }
      .coach-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      .coach-buttons .button {
        flex: 1 1 5.5rem;
        min-height: 56px;
        font-size: 1.05rem;
      }
    `,
  ],
})
export class MemorizeCoachBarComponent {
  readonly coach = inject(MemorizeCoach);
}
