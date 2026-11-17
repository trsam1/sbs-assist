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
      providers: [provideRouter([]), { provide: AuthService, useValue: mockAuth }],
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

  it('should show Books and Word Studies in the navbar', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.navbar-start .navbar-item'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(links).toEqual(['Books', 'Word Studies']);
  });

  it('should brand the navbar and link it to the books home', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const brand = fixture.nativeElement.querySelector('.navbar-brand .navbar-item') as HTMLElement;
    expect(brand.textContent?.trim()).toBe('Axios Bible Study Tools');
    expect(brand.getAttribute('href')).toBe('/books');
  });
});
