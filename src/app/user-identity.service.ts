import { Injectable } from '@angular/core';

const STORAGE_KEY = 'word-study-user-id';

/** Generates and persists an anonymous user ID in localStorage. */
@Injectable({ providedIn: 'root' })
export class UserIdentityService {
  private userId: string;

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      this.userId = stored;
    } else {
      this.userId = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, this.userId);
    }
  }

  /** Returns the anonymous user ID (stable across visits). */
  getUserId(): string {
    return this.userId;
  }
}
