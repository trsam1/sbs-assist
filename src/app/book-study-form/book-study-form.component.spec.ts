import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookStudyFormComponent } from './book-study-form.component';
import { environment } from '../environment';

describe('BookStudyFormComponent', () => {
  let fixture: ComponentFixture<BookStudyFormComponent>;
  let component: BookStudyFormComponent;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookStudyFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(BookStudyFormComponent);
    component = fixture.componentInstance;
    httpTesting = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function queryAll(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render OT and NT optgroups with 39 and 27 options', () => {
    const optgroups = queryAll('optgroup');
    expect(optgroups.length).toBe(2);
    expect(optgroups[0].getAttribute('label')).toBe('Old Testament');
    expect(optgroups[1].getAttribute('label')).toBe('New Testament');
    expect(optgroups[0].querySelectorAll('option').length).toBe(39);
    expect(optgroups[1].querySelectorAll('option').length).toBe(27);
  });

  it('should disable Save until a book is selected', () => {
    const saveBtn = query('[data-testid="save-button"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    component.form.controls.book.setValue('Genesis');
    fixture.detectChanges();

    expect(saveBtn.disabled).toBe(false);
  });

  it('should create then navigate to /books on success', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    component.form.setValue({ book: 'John', title: 'John study', notes: 'notes' });
    fixture.detectChanges();

    (query('[data-testid="save-button"]') as HTMLButtonElement).click();

    const req = httpTesting.expectOne(`${environment.apiUrl}/books`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ book: 'John', title: 'John study', notes: 'notes' });
    req.flush({ bookStudyId: 'new-id' });

    expect(navigateSpy).toHaveBeenCalledWith(['/books']);
  });

  it('should preserve input and show an error when create fails', () => {
    component.form.setValue({ book: 'Mark', title: 'Keep me', notes: 'and me' });
    fixture.detectChanges();

    (query('[data-testid="save-button"]') as HTMLButtonElement).click();

    const req = httpTesting.expectOne(`${environment.apiUrl}/books`);
    req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.saveState()).toBe('error');
    expect(query('[data-testid="save-error"]')).not.toBeNull();
    // Entered values are preserved.
    expect(component.form.value.book).toBe('Mark');
    expect(component.form.value.title).toBe('Keep me');
    expect(component.form.value.notes).toBe('and me');
  });
});
