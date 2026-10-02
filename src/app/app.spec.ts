import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from './app';
import { AuthService } from './auth.service';

describe('App', () => {
  let mockAuth: Partial<AuthService>;

  beforeEach(() => {
    mockAuth = {
      state: (() => 'signedIn') as unknown as AuthService['state'],
      isSignedIn: (() => true) as unknown as AuthService['isSignedIn'],
      userEmail: (() => 'test@example.com') as unknown as AuthService['userEmail'],
      error: (() => null) as unknown as AuthService['error'],
      signOut: () => Promise.resolve(),
    };

    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuth },
      ],
    });
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show navbar when signed in', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const nav = fixture.nativeElement.querySelector('nav[aria-label="main navigation"]');
    expect(nav).not.toBeNull();
  });

  it('should display user email in navbar', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('test@example.com');
  });
});
