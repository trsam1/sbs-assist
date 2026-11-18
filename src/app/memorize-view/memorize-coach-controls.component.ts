import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MemorizeCoach } from './memorize-coach';
import { MemorizeStore } from './memorize-store';
import { MemorizeTest } from './memorize-test.service';

/**
 * The start button for audio coaching plus the coach's settings. Used in the Learn pane ("Coach me") and the
 * Test pane ("Coach test"). Hidden when the browser cannot speak.
 */
@Component({
  selector: 'app-memorize-coach-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!coach.supported) {
      <p class="help" data-testid="coach-unsupported">
        Audio coaching needs speech, which this browser does not offer.
      </p>
    } @else {
      <div class="mb-3" data-testid="coach-controls">
        @if (kind() === 'learn') {
          <button
            type="button"
            class="button is-link"
            [disabled]="coach.mode() !== 'off' || !store.learnChunk()"
            (click)="coach.startLearn()"
            data-testid="coach-start-learn"
          >
            Coach me
          </button>
          <span class="help ml-2">Listen and repeat, phrase by phrase. Nothing is graded.</span>
        } @else {
          <button
            type="button"
            class="button is-link"
            [disabled]="
              coach.mode() !== 'off' || store.deckComplete() || !test.recordingSupported()
            "
            (click)="coach.startTest()"
            data-testid="coach-start-test"
          >
            Coach test
          </button>
          <span class="help ml-2">Hands-free: it asks, listens, and tells you how you did.</span>
        }

        <details class="mt-2" (toggle)="coach.ensureVoices()" data-testid="coach-settings">
          <summary class="is-size-7">Coach settings</summary>
          <div class="box mt-2">
            <div class="field">
              <label class="label is-small" for="coach-rate">Speech speed</label>
              <input
                id="coach-rate"
                type="range"
                min="0.7"
                max="1.3"
                step="0.05"
                [value]="coach.prefs().rate"
                (input)="coach.setPrefs({ rate: +$any($event.target).value })"
                data-testid="coach-rate"
              />
              <span class="help">{{ coach.prefs().rate }}×</span>
            </div>
            <div class="field">
              <label class="label is-small" for="coach-pause">Time to repeat each word</label>
              <input
                id="coach-pause"
                type="range"
                min="300"
                max="2000"
                step="100"
                [value]="coach.prefs().perWordMs"
                (input)="coach.setPrefs({ perWordMs: +$any($event.target).value })"
                data-testid="coach-pause-ms"
              />
              <span class="help">{{ coach.prefs().perWordMs }} ms per word</span>
            </div>
            @if (kind() === 'test') {
              <div class="field">
                <label class="label is-small" for="coach-silence"
                  >Stop listening after quiet for</label
                >
                <input
                  id="coach-silence"
                  type="range"
                  min="1200"
                  max="6000"
                  step="100"
                  [value]="coach.prefs().silenceMs"
                  (input)="coach.setPrefs({ silenceMs: +$any($event.target).value })"
                  data-testid="coach-silence-ms"
                />
                <span class="help">{{ coach.prefs().silenceMs / 1000 }} seconds</span>
              </div>
            }
            @if (coach.voices().length > 0) {
              <div class="field">
                <label class="label is-small" for="coach-voice">Voice</label>
                <div class="select is-small">
                  <select
                    id="coach-voice"
                    [value]="coach.prefs().voiceName"
                    (change)="coach.setPrefs({ voiceName: $any($event.target).value })"
                    data-testid="coach-voice"
                  >
                    <option value="">Browser default</option>
                    @for (v of coach.voices(); track v.name) {
                      <option [value]="v.name">{{ v.name }} ({{ v.lang }})</option>
                    }
                  </select>
                </div>
              </div>
            }
            <label class="checkbox">
              <input
                type="checkbox"
                [checked]="coach.prefs().tones"
                (change)="coach.setPrefs({ tones: $any($event.target).checked })"
                data-testid="coach-tones"
              />
              Play a tone when it starts listening
            </label>
          </div>
        </details>
      </div>
    }
  `,
})
export class MemorizeCoachControlsComponent {
  readonly coach = inject(MemorizeCoach);
  readonly store = inject(MemorizeStore);
  readonly test = inject(MemorizeTest);
  readonly kind = input.required<'learn' | 'test'>();
}
