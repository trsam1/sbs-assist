import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserIdentityService } from './user-identity.service';

const STORAGE_KEY = 'word-study-user-id';

describe('UserIdentityService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function createService(): UserIdentityService {
    TestBed.configureTestingModule({});
    return TestBed.inject(UserIdentityService);
  }

  it('should generate a UUID and store it in localStorage on first visit', () => {
    const service = createService();
    const id = service.getUserId();

    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it('should return a valid UUID format', () => {
    const service = createService();
    const id = service.getUserId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidRegex);
  });

  it('should return the same ID on subsequent calls', () => {
    const service = createService();
    const id1 = service.getUserId();
    const id2 = service.getUserId();
    expect(id1).toBe(id2);
  });

  it('should reuse existing ID from localStorage', () => {
    const existingId = 'pre-existing-uuid-1234';
    localStorage.setItem(STORAGE_KEY, existingId);

    const service = createService();
    expect(service.getUserId()).toBe(existingId);
  });

  it('should not overwrite existing localStorage value', () => {
    const existingId = 'keep-this-id';
    localStorage.setItem(STORAGE_KEY, existingId);

    createService();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(existingId);
  });

  it('should not store any personally identifiable information', () => {
    const service = createService();
    const id = service.getUserId();

    // The stored value should only be the UUID — nothing else in the key
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id);
    expect(localStorage.length).toBe(1);
  });
});
