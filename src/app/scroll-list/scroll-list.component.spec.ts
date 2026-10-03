import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScrollListComponent } from './scroll-list.component';
import { StudyCrudService } from '../study-crud.service';
import { environment } from '../environment';

/** Raw API record shape (DynamoDB field names) for flushing list responses. */
function record(overrides: Record<string, unknown> = {}) {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    bookName: 'Genesis',
    status: 'ready',
    scrollText: 'text',
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T12:00:00.000Z',
    ...overrides,
  };
}

describe('ScrollListComponent', () => {
  let fixture: ComponentFixture<ScrollListComponent>;
  let component: ScrollListComponent;
  let httpTesting: HttpTestingController;
  const studyCrudGuard = { listStudies: vi.fn() };

  beforeEach(async () => {
    studyCrudGuard.listStudies.mockReset();
    await TestBed.configureTestingModule({
      imports: [ScrollListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: StudyCrudService, useValue: studyCrudGuard },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScrollListComponent);
    component = fixture.componentInstance;
    httpTesting = TestBed.inject(HttpTestingController);
  });

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }
  function queryAll(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }
  function flushList(records: ReturnType<typeof record>[]): void {
    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/scroll-studies`);
    req.flush(records);
    fixture.detectChanges();
  }

  it('shows loading on init', () => {
    fixture.detectChanges();
    expect(component.state()).toBe('loading');
    expect(query('[data-testid="scroll-loading"]')).not.toBeNull();
  });

  it('lists only scroll studies, sorted most-recently-updated first', () => {
    fixture.detectChanges();
    flushList([
      record({ scrollStudyId: 'old', updatedAt: '2026-01-01T00:00:00.000Z', bookName: 'Mark' }),
      record({ scrollStudyId: 'new', updatedAt: '2026-05-01T00:00:00.000Z', bookName: 'Luke' }),
    ]);

    expect(component.state()).toBe('loaded');
    const books = queryAll('[data-testid="scroll-book"]').map((e) => e.textContent?.trim());
    expect(books).toEqual(['Luke', 'Mark']);

    // Regression: the scroll list never calls the word-study service.
    expect(studyCrudGuard.listStudies).not.toHaveBeenCalled();
  });

  it('renders a status tag reflecting the study status', () => {
    fixture.detectChanges();
    flushList([
      record({ scrollStudyId: 'a', status: 'extracting', updatedAt: '2026-03-01T00:00:00.000Z' }),
      record({ scrollStudyId: 'b', status: 'ready', updatedAt: '2026-02-01T00:00:00.000Z' }),
      record({ scrollStudyId: 'c', status: 'failed', updatedAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    const tags = queryAll('[data-testid="scroll-status"]');
    expect(tags[0].classList.contains('is-warning')).toBe(true);
    expect(tags[1].classList.contains('is-success')).toBe(true);
    expect(tags[2].classList.contains('is-danger')).toBe(true);
  });

  it('shows the empty state when there are no scroll studies', () => {
    fixture.detectChanges();
    flushList([]);
    const empty = query('[data-testid="scroll-empty-state"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain('No scroll studies yet');
  });

  it('shows an error state with retry on failure', () => {
    fixture.detectChanges();
    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/scroll-studies`);
    req.flush('err', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    expect(query('[data-testid="scroll-retry-button"]')).not.toBeNull();
  });

  it('navigates to /scroll/:id when Open is clicked', () => {
    fixture.detectChanges();
    flushList([record({ scrollStudyId: 'open-me' })]);

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');
    (query('[data-testid="open-scroll-button"]') as HTMLButtonElement).click();
    expect(navigateSpy).toHaveBeenCalledWith(['/scroll', 'open-me']);
  });

  it('deletes a scroll study on confirm and removes it from the list', () => {
    fixture.detectChanges();
    flushList([record({ scrollStudyId: 's1' }), record({ scrollStudyId: 's2' })]);

    expect(queryAll('[data-testid="scroll-row"]').length).toBe(2);
    (queryAll('[data-testid="delete-scroll-button"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-scroll-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const del = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/scroll-studies/s1`,
    );
    del.flush(null);
    fixture.detectChanges();

    expect(query('[data-testid="scroll-delete-modal"]')).toBeNull();
    expect(queryAll('[data-testid="scroll-row"]').length).toBe(1);
    expect(component.studies()[0].id).toBe('s2');
  });

  it('shows a delete error notification when delete fails', () => {
    fixture.detectChanges();
    flushList([record({ scrollStudyId: 's1' })]);

    (query('[data-testid="delete-scroll-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-scroll-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const del = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/scroll-studies/s1`,
    );
    del.flush('err', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(query('[data-testid="scroll-delete-error"]')).not.toBeNull();
    expect(queryAll('[data-testid="scroll-row"]').length).toBe(1);
  });

  it('uses an alertdialog role on the delete modal', () => {
    fixture.detectChanges();
    flushList([record({ scrollStudyId: 's1' })]);

    (query('[data-testid="delete-scroll-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const modal = query('[role="alertdialog"]');
    expect(modal).not.toBeNull();
    expect(modal!.getAttribute('aria-modal')).toBe('true');
    expect(modal!.textContent).toContain('Genesis');
  });
});
