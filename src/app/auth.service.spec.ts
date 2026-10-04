import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signIn, confirmSignIn, getCurrentUser } from 'aws-amplify/auth';
import { AuthService } from './auth.service';

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
}));

const signInMock = vi.mocked(signIn);
const confirmSignInMock = vi.mocked(confirmSignIn);
const getCurrentUserMock = vi.mocked(getCurrentUser);

describe('AuthService sign-in challenge handling', () => {
  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Constructor calls checkSession(); reject so the service lands on signedOut.
    getCurrentUserMock.mockRejectedValue(new Error('not authenticated'));
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthService);
    // Let the constructor's checkSession() settle to signedOut.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('(a) sets signed-in state when sign-in completes', async () => {
    signInMock.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } } as never);

    await service.signIn('user@example.com', 'password1');

    expect(service.state()).toBe('signedIn');
    expect(service.userEmail()).toBe('user@example.com');
    expect(service.error()).toBeNull();
  });

  it('(b) shows new-password step then signs in after confirmNewPassword', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
    } as never);

    await service.signIn('user@example.com', 'temp-pass');

    expect(service.state()).toBe('newPasswordRequired');
    expect(service.error()).toBeNull();

    confirmSignInMock.mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' },
    } as never);

    await service.confirmNewPassword('newStrongPass1');

    expect(service.state()).toBe('signedIn');
    expect(service.userEmail()).toBe('user@example.com');
    expect(service.error()).toBeNull();
  });

  it('(c) surfaces a visible error and stays recoverable on a wrong new password', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
    } as never);
    await service.signIn('user@example.com', 'temp-pass');
    expect(service.state()).toBe('newPasswordRequired');

    confirmSignInMock.mockRejectedValue(new Error('Password does not conform to policy'));

    await service.confirmNewPassword('weak');

    expect(service.error()).toBe('Password does not conform to policy');
    expect(service.state()).toBe('newPasswordRequired');
  });

  it('(d) shows a visible error for an unexpected sign-in step without claiming signed-in', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' },
    } as never);

    await service.signIn('user@example.com', 'password1');

    expect(service.error()).toBeTruthy();
    expect(service.error()).toContain('CONFIRM_SIGN_IN_WITH_SMS_CODE');
    expect(service.state()).not.toBe('signedIn');
  });
});
