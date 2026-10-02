import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { AuthComponent } from './auth/auth.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AuthComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.state() === 'loading') {
      <div class="section has-text-centered">
        <p>Loading…</p>
      </div>
    } @else if (!auth.isSignedIn()) {
      <app-auth />
    } @else {
      <nav class="navbar is-primary" role="navigation" aria-label="main navigation">
        <div class="navbar-brand">
          <a class="navbar-item has-text-weight-bold" routerLink="/"> Bible Word Study Tool </a>
          <button
            class="navbar-burger"
            [class.is-active]="isMobileMenuOpen()"
            aria-label="menu"
            [attr.aria-expanded]="isMobileMenuOpen()"
            (click)="toggleMobileMenu()"
            (keydown.enter)="toggleMobileMenu()"
            (keydown.space)="toggleMobileMenu(); $event.preventDefault()"
          >
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
          </button>
        </div>
        <div class="navbar-menu" [class.is-active]="isMobileMenuOpen()">
          <div class="navbar-start">
            <a
              class="navbar-item"
              routerLink="/"
              routerLinkActive="is-active"
              [routerLinkActiveOptions]="{ exact: true }"
              >My Studies</a
            >
            <a class="navbar-item" routerLink="/study/new" routerLinkActive="is-active"
              >New Study</a
            >
          </div>
          <div class="navbar-end">
            <div class="navbar-item">
              <span class="is-size-7 mr-3">{{ auth.userEmail() }}</span>
              <button class="button is-small is-light" (click)="onSignOut()">Sign Out</button>
            </div>
          </div>
        </div>
      </nav>
      <main class="section">
        <div class="container">
          <router-outlet />
        </div>
      </main>
    }
  `,
})
export class App {
  readonly auth = inject(AuthService);
  readonly isMobileMenuOpen = signal(false);

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update((open) => !open);
  }

  onSignOut(): void {
    this.auth.signOut();
  }
}
