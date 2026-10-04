import { Injectable, signal, computed } from '@angular/core';
import { Amplify } from 'aws-amplify';
import {
  signIn,
  confirmSignIn,
  signUp,
  signOut,
  confirmSignUp,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { RuntimeConfig } from './environment';

/**
 * Configures Amplify from the runtime config. Called once by the app initializer
 * (app.config.ts) before any component, and therefore AuthService, is created.
 */
export function configureAmplify(cfg: RuntimeConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: cfg.cognitoUserPoolId,
        userPoolClientId: cfg.cognitoUserPoolClientId,
      },
    },
  });
}

export type AuthState =
  | 'loading'
  | 'signedOut'
  | 'signedIn'
  | 'confirmSignUp'
  | 'newPasswordRequired';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly state = signal<AuthState>('loading');
  readonly userEmail = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  /** Email pending confirmation after sign-up. */
  private pendingEmail = '';
  private pendingPassword = '';

  readonly isSignedIn = computed(() => this.state() === 'signedIn');

  constructor() {
    this.checkSession();
  }

  private async checkSession(): Promise<void> {
    try {
      const user = await getCurrentUser();
      this.userEmail.set(user.signInDetails?.loginId ?? null);
      this.state.set('signedIn');
    } catch {
      this.state.set('signedOut');
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    this.error.set(null);
    try {
      const result = await signIn({ username: email, password });
      if (result.isSignedIn) {
        this.userEmail.set(email);
        this.state.set('signedIn');
        return;
      }
      const step = result.nextStep.signInStep;
      if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        this.pendingEmail = email;
        this.state.set('newPasswordRequired');
      } else {
        this.error.set(
          `This account needs an additional sign-in step (${step}) that isn't supported here.`,
        );
      }
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Sign in failed.');
    }
  }

  /**
   * Completes a NEW_PASSWORD_REQUIRED challenge raised by signIn() (e.g. a user
   * left in FORCE_CHANGE_PASSWORD by admin-create-user). On success the app
   * advances to the signed-in state; a failure surfaces a visible error and
   * keeps the new-password step so the user can retry.
   */
  async confirmNewPassword(newPassword: string): Promise<void> {
    this.error.set(null);
    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      if (result.isSignedIn) {
        this.userEmail.set(this.pendingEmail);
        this.state.set('signedIn');
      } else {
        this.error.set('Could not set the new password. Please try again.');
        this.state.set('newPasswordRequired');
      }
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Could not set the new password.');
      this.state.set('newPasswordRequired');
    }
  }

  async signUp(email: string, password: string): Promise<void> {
    this.error.set(null);
    try {
      const result = await signUp({ username: email, password });
      if (!result.isSignUpComplete) {
        this.pendingEmail = email;
        this.pendingPassword = password;
        this.state.set('confirmSignUp');
      }
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Sign up failed.');
    }
  }

  async confirmSignUp(code: string): Promise<void> {
    this.error.set(null);
    try {
      await confirmSignUp({ username: this.pendingEmail, confirmationCode: code });
      // Auto sign-in after confirmation
      await this.signIn(this.pendingEmail, this.pendingPassword);
      this.pendingPassword = '';
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Confirmation failed.');
    }
  }

  async signOut(): Promise<void> {
    this.error.set(null);
    try {
      await signOut();
      this.userEmail.set(null);
      this.state.set('signedOut');
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Sign out failed.');
    }
  }

  /** Get the current ID token for API calls. Returns null if not signed in. */
  async getIdToken(): Promise<string | null> {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() ?? null;
    } catch {
      return null;
    }
  }
}
