import { Injectable, signal, computed } from '@angular/core';
import { Amplify } from 'aws-amplify';
import {
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { environment } from './environment';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: environment.cognitoUserPoolId,
      userPoolClientId: environment.cognitoUserPoolClientId,
    },
  },
});

export type AuthState = 'loading' | 'signedOut' | 'signedIn' | 'confirmSignUp';

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
      }
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Sign in failed.');
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
