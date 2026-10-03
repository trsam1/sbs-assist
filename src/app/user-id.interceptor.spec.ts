import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { userIdInterceptor } from './user-id.interceptor';
import { AuthService } from './auth.service';

describe('userIdInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    const mockAuth = {
      getIdToken: vi.fn().mockResolvedValue('mock-jwt-token'),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([userIdInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: mockAuth },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('should add Authorization header to /studies requests', async () => {
    const sub = http.get('/api/studies').subscribe();
    // Allow the microtask (Promise) to resolve
    await new Promise((r) => setTimeout(r, 0));

    const req = httpTesting.expectOne('/api/studies');
    expect(req.request.headers.get('Authorization')).toBe('mock-jwt-token');
    req.flush([]);
    sub.unsubscribe();
  });

  it('should add Authorization header to /ai/ requests', async () => {
    const sub = http.post('/api/ai/study-summary', {}).subscribe();
    await new Promise((r) => setTimeout(r, 0));

    const req = httpTesting.expectOne('/api/ai/study-summary');
    expect(req.request.headers.get('Authorization')).toBe('mock-jwt-token');
    req.flush({});
    sub.unsubscribe();
  });

  it('should add Authorization header to /books requests', async () => {
    const sub = http.get('/api/books').subscribe();
    await new Promise((r) => setTimeout(r, 0));

    const req = httpTesting.expectOne('/api/books');
    expect(req.request.headers.get('Authorization')).toBe('mock-jwt-token');
    req.flush([]);
    sub.unsubscribe();
  });

  it('should NOT add Authorization header to external API requests', () => {
    http.get('https://api.dictionaryapi.dev/api/v2/entries/en/love').subscribe();

    const req = httpTesting.expectOne('https://api.dictionaryapi.dev/api/v2/entries/en/love');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });
});
