import {
  ChangeDetectionStrategy,
  Component,
  output,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

@Component({
  selector: 'app-study-input',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="onSubmit()"
      class="box"
      aria-label="Word study input"
    >
      <div class="field">
        <label class="label" for="word-input">English Word</label>
        <div class="control">
          <input
            id="word-input"
            class="input"
            type="text"
            formControlName="word"
            placeholder="e.g. love, appointed, faith"
            [class.is-danger]="showError()"
            aria-required="true"
            [attr.aria-invalid]="showError()"
            [attr.aria-describedby]="showError() ? 'word-error' : null"
          />
        </div>
        @if (showError()) {
          <p id="word-error" class="help is-danger" role="alert">
            Please enter a word to study.
          </p>
        }
      </div>

      <div class="field">
        <div class="control">
          <button
            type="submit"
            class="button is-primary"
            [disabled]="form.invalid"
          >
            Begin Study
          </button>
        </div>
      </div>
    </form>
  `,
})
export class StudyInputComponent {
  readonly wordSubmitted = output<string>();

  readonly form = new FormGroup({
    word: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  showError(): boolean {
    const control = this.form.controls.word;
    return control.invalid && (control.dirty || control.touched);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.wordSubmitted.emit(this.form.getRawValue().word.trim());
  }
}
