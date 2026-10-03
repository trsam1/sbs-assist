import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookStudyDetailComponent } from './book-study-detail.component';
import { environment } from '../environment';

function configure(bookStudyId: string) {
  TestBed.configureTestingModule({
    imports: [BookStudyDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ bookStudyId }) } },
      },
    ],
  });
}

describe('BookStudyDetailComponent', () => {
  let fixture: ComponentFixture<BookStudyDetailComponent>;
  let component: BookStudyDetailComponent;
  let httpTesting: HttpTestingController;

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function createWith(bookStudyId: string) {
    configure(bookStudyId);
    fixture = TestBed.createComponent(BookStudyDetailComponent);
    component = fixture.componentInstance;
    httpTesting = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // ngOnInit
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('should render book, title, notes and timestamps on success', () => {
    createWith('b1');

    const req = httpTesting.expectOne(`${environment.apiUrl}/books/b1`);
    expect(req.request.method).toBe('GET');
    req.flush({
      bookStudyId: 'b1',
      userId: 'u1',
      book: 'Genesis',
      title: 'My study',
      notes: 'line one\nline two',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    });
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(query('[data-testid="detail-book"]')!.textContent).toContain('Genesis');
    expect(query('[data-testid="detail-title"]')!.textContent).toContain('My study');
    expect(query('[data-testid="detail-notes"]')!.textContent).toContain('line one');
    expect(query('[data-testid="detail-timestamps"]')).not.toBeNull();
  });

  it('should show a not-found message with a back link on 404', () => {
    createWith('missing');

    const req = httpTesting.expectOne(`${environment.apiUrl}/books/missing`);
    req.flush('Not found', { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(component.state()).toBe('notfound');
    const notFound = query('[data-testid="not-found"]');
    expect(notFound).not.toBeNull();
    // Back link to /books is present in the template.
    expect(query('[data-testid="back-link"]')).not.toBeNull();
  });

  it('should delete after confirmation and navigate back to /books', () => {
    createWith('b1');

    const getReq = httpTesting.expectOne(`${environment.apiUrl}/books/b1`);
    getReq.flush({
      bookStudyId: 'b1',
      userId: 'u1',
      book: 'John',
      title: '',
      notes: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    (query('[data-testid="delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).not.toBeNull();

    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();

    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/books/b1`,
    );
    deleteReq.flush(null);

    expect(navigateSpy).toHaveBeenCalledWith(['/books']);
  });
});
