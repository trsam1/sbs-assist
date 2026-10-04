import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-auth',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section">
      <div class="container">
        <div class="columns is-centered">
          <div class="column is-5">
            <div class="box">
              <h2 class="title is-4 has-text-centered">Bible Word Study Tool</h2>

              @if (auth.error()) {
                <div class="notification is-danger is-light" role="alert">
                  {{ auth.error() }}
                </div>
              }

              @if (auth.state() === 'confirmSignUp') {
                <p class="has-text-centered mb-4">Check your email for a verification code.</p>
                <div class="field">
                  <label class="label" for="code-input">Verification Code</label>
                  <div class="control">
                    <input
                      class="input"
                      id="code-input"
                      type="text"
                      [(ngModel)]="code"
                      placeholder="Enter 6-digit code"
                    />
                  </div>
                </div>
                <button
                  class="button is-primary is-fullwidth"
                  [class.is-loading]="submitting()"
                  [disabled]="!code || submitting()"
                  (click)="onConfirm()"
                >
                  Verify
                </button>
              } @else if (auth.state() === 'newPasswordRequired') {
                <p class="has-text-centered mb-4">
                  Your account requires a new password. Set one to finish signing in.
                </p>
                <div class="field">
                  <label class="label" for="new-password-input">New Password</label>
                  <div class="control">
                    <input
                      class="input"
                      id="new-password-input"
                      type="password"
                      [(ngModel)]="newPassword"
                      placeholder="New password"
                    />
                  </div>
                </div>
                <button
                  class="button is-primary is-fullwidth"
                  [class.is-loading]="submitting()"
                  [disabled]="!newPassword || submitting()"
                  (click)="onConfirmNewPassword()"
                >
                  Set Password
                </button>
              } @else {
                <div class="tabs is-centered">
                  <ul>
                    <li [class.is-active]="mode() === 'signIn'">
                      <a
                        tabindex="0"
                        (click)="mode.set('signIn')"
                        (keydown.enter)="mode.set('signIn')"
                        >Sign In</a
                      >
                    </li>
                    <li [class.is-active]="mode() === 'signUp'">
                      <a
                        tabindex="0"
                        (click)="mode.set('signUp')"
                        (keydown.enter)="mode.set('signUp')"
                        >Sign Up</a
                      >
                    </li>
                  </ul>
                </div>

                <div class="field">
                  <label class="label" for="email-input">Email</label>
                  <div class="control">
                    <input
                      class="input"
                      id="email-input"
                      type="email"
                      [(ngModel)]="email"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
                <div class="field">
                  <label class="label" for="password-input">Password</label>
                  <div class="control">
                    <input
                      class="input"
                      id="password-input"
                      type="password"
                      [(ngModel)]="password"
                      placeholder="Password"
                    />
                  </div>
                </div>

                @if (mode() === 'signIn') {
                  <button
                    class="button is-primary is-fullwidth"
                    [class.is-loading]="submitting()"
                    [disabled]="!email || !password || submitting()"
                    (click)="onSignIn()"
                  >
                    Sign In
                  </button>
                } @else {
                  <p class="help mb-3">Password must be at least 8 characters with a number.</p>
                  <button
                    class="button is-primary is-fullwidth"
                    [class.is-loading]="submitting()"
                    [disabled]="!email || !password || submitting()"
                    (click)="onSignUp()"
                  >
                    Create Account
                  </button>
                }
              }
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class AuthComponent {
  readonly auth = inject(AuthService);
  readonly mode = signal<'signIn' | 'signUp'>('signIn');
  readonly submitting = signal(false);

  email = '';
  password = '';
  code = '';
  newPassword = '';

  async onSignIn(): Promise<void> {
    this.submitting.set(true);
    await this.auth.signIn(this.email, this.password);
    this.submitting.set(false);
  }

  async onSignUp(): Promise<void> {
    this.submitting.set(true);
    await this.auth.signUp(this.email, this.password);
    this.submitting.set(false);
  }

  async onConfirm(): Promise<void> {
    this.submitting.set(true);
    await this.auth.confirmSignUp(this.code);
    this.submitting.set(false);
  }

  async onConfirmNewPassword(): Promise<void> {
    this.submitting.set(true);
    await this.auth.confirmNewPassword(this.newPassword);
    this.submitting.set(false);
  }
}
