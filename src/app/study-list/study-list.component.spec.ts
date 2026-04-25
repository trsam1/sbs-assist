import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StudyListComponent } from './study-list.component';
import { StudyWorksheet } from '../models';
import { environment } from '../environment';

function makeStudy(overrides: Partial<StudyWorksheet> = {}): StudyWorksheet {
  return {
    id: 'study-1',
    userId: 'anonymous',
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-02T12:00:00.000Z',
    wordStudies: [
      {
        word: 'love',
        strongsNumber: 'G25',
        englishDefinition: 'deep affection',
        strongsDefinition: 'to love',
        originalWord: 'ἀγαπάω',
        transliteration: 'agapaō',
        lexiconEntry: 'From ἀγάπη; to love...',
        crossReferences: [],
        aiSummary: '',
        notes: '',
      },
    ],
    status: 'in_progress',
    ...overrides,
  };
}

describe('StudyListComponent', () => {
  let fixture: ComponentFixture<StudyListComponent>;
  let component: StudyListComponent;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudyListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(StudyListComponent);
    component = fixture.componentInstance;
  });

  function getHttpTesting(): HttpTestingController {
    return TestBed.inject(HttpTestingController);
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function queryAll(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show loading state on init', () => {
    fixture.detectChanges(); // triggers ngOnInit
    expect(component.state()).toBe('loading');
    expect(query('[data-testid="loading"]')).not.toBeNull();
  });

  it('should display studies after successful fetch', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const studies = [
      makeStudy({ id: 's1' }),
      makeStudy({
        id: 's2',
        wordStudies: [{
          word: 'faith',
          strongsNumber: 'G4102',
          englishDefinition: '',
          strongsDefinition: 'persuasion',
          originalWord: 'πίστις',
          transliteration: 'pistis',
          lexiconEntry: '',
          crossReferences: [],
          aiSummary: '',
          notes: '',
        }],
        status: 'completed',
      }),
    ];

    const req = httpTesting.expectOne(
      (r) => r.url === `${environment.apiUrl}/studies`,
    );
    req.flush(studies);
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(queryAll('[data-testid="study-row"]').length).toBe(2);

    const words = queryAll('[data-testid="study-word"]').map((el) => el.textContent?.trim());
    expect(words).toEqual(['love', 'faith']);

    const strongs = queryAll('[data-testid="study-strongs"]').map((el) => el.textContent?.trim());
    expect(strongs).toEqual(['G25', 'G4102']);

    const statuses = queryAll('[data-testid="study-status"]').map((el) => el.textContent?.trim());
    expect(statuses).toEqual(['In Progress', 'Completed']);
  });

  it('should show empty state when no studies exist', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne(
      (r) => r.url === `${environment.apiUrl}/studies`,
    );
    req.flush([]);
    fixture.detectChanges();

    expect(query('[data-testid="empty-state"]')).not.toBeNull();
    expect(query('[data-testid="empty-state"]')!.textContent).toContain('No saved studies yet');
  });

  it('should show error state on fetch failure', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    expect(query('[data-testid="error"]')).not.toBeNull();
  });

  it('should retry loading when retry button is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    // First request fails
    const req1 = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req1.flush('Error', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    // Click retry
    const retryBtn = query('[data-testid="retry-button"]') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    retryBtn.click();
    fixture.detectChanges();

    // Second request succeeds
    const req2 = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req2.flush([makeStudy()]);
    fixture.detectChanges();

    expect(component.state()).toBe('loaded');
    expect(queryAll('[data-testid="study-row"]').length).toBe(1);
  });

  it('should display dash for word when wordStudies is empty', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ wordStudies: [] })]);
    fixture.detectChanges();

    const word = query('[data-testid="study-word"]');
    expect(word?.textContent?.trim()).toBe('—');
  });

  it('should show study count', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' }), makeStudy({ id: 's2' })]);
    fixture.detectChanges();

    const count = query('[data-testid="study-count"]');
    expect(count?.textContent).toContain('2 study(ies) found');
  });

  it('should display status tags with correct classes', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([
      makeStudy({ id: 's1', status: 'in_progress' }),
      makeStudy({ id: 's2', status: 'completed' }),
    ]);
    fixture.detectChanges();

    const tags = queryAll('[data-testid="study-status"] .tag');
    expect(tags[0].classList.contains('is-warning')).toBe(true);
    expect(tags[1].classList.contains('is-success')).toBe(true);
  });

  it('should render an Open button for each study row', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' }), makeStudy({ id: 's2' })]);
    fixture.detectChanges();

    const buttons = queryAll('[data-testid="open-study-button"]');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent?.trim()).toBe('Open');
  });

  it('should navigate to study route when Open is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const study = makeStudy({ id: 'open-me' });
    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([study]);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const openBtn = query('[data-testid="open-study-button"]') as HTMLButtonElement;
    openBtn.click();
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledOnce();
    expect(navigateSpy).toHaveBeenCalledWith(['/study', 'open-me']);
  });

  it('should set accessible aria-label on Open button', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    const openBtn = query('[data-testid="open-study-button"]') as HTMLButtonElement;
    expect(openBtn.getAttribute('aria-label')).toBe('Open study for love');
  });

  // --- Delete with confirmation tests ---

  it('should render a Delete button for each study row', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' }), makeStudy({ id: 's2' })]);
    fixture.detectChanges();

    const buttons = queryAll('[data-testid="delete-study-button"]');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent?.trim()).toBe('Delete');
  });

  it('should set accessible aria-label on Delete button', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    const deleteBtn = query('[data-testid="delete-study-button"]') as HTMLButtonElement;
    expect(deleteBtn.getAttribute('aria-label')).toBe('Delete study for love');
  });

  it('should show confirmation modal when Delete is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    expect(query('[data-testid="delete-modal"]')).toBeNull();

    const deleteBtn = query('[data-testid="delete-study-button"]') as HTMLButtonElement;
    deleteBtn.click();
    fixture.detectChanges();

    const modal = query('[data-testid="delete-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('love');
    expect(modal!.textContent).toContain('G25');
  });

  it('should close modal when Cancel is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    // Open modal
    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).not.toBeNull();

    // Cancel
    (query('[data-testid="cancel-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).toBeNull();
  });

  it('should close modal when close (X) button is clicked', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const req = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    req.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    (query('[data-testid="delete-modal-close"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="delete-modal"]')).toBeNull();
  });

  it('should delete study and remove it from the list on confirm', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const studies = [makeStudy({ id: 's1' }), makeStudy({ id: 's2' })];
    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush(studies);
    fixture.detectChanges();

    expect(queryAll('[data-testid="study-row"]').length).toBe(2);

    // Click delete on first study
    (queryAll('[data-testid="delete-study-button"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    // Confirm
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Respond to DELETE request
    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/studies/s1`,
    );
    deleteReq.flush(null);
    fixture.detectChanges();

    // Modal closed, study removed
    expect(query('[data-testid="delete-modal"]')).toBeNull();
    expect(queryAll('[data-testid="study-row"]').length).toBe(1);
    expect(component.studies().length).toBe(1);
    expect(component.studies()[0].id).toBe('s2');
  });

  it('should show error notification when delete fails', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    // Open modal and confirm
    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Fail the DELETE request
    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/studies/s1`,
    );
    deleteReq.flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    // Modal closed, study still in list, error shown
    expect(query('[data-testid="delete-modal"]')).toBeNull();
    expect(queryAll('[data-testid="study-row"]').length).toBe(1);
    const errorNotif = query('[data-testid="delete-error"]');
    expect(errorNotif).not.toBeNull();
    expect(errorNotif!.textContent).toContain('Failed to delete study');
  });

  it('should show loading state on confirm button during delete', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="confirm-delete-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // While request is in flight, button should be loading/disabled
    const confirmBtn = query('[data-testid="confirm-delete-button"]') as HTMLButtonElement;
    expect(confirmBtn.classList.contains('is-loading')).toBe(true);
    expect(confirmBtn.disabled).toBe(true);

    // Complete the request
    const deleteReq = httpTesting.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/studies/s1`,
    );
    deleteReq.flush(null);
    fixture.detectChanges();
  });

  it('should use alertdialog role on the confirmation modal', () => {
    fixture.detectChanges();
    httpTesting = getHttpTesting();

    const listReq = httpTesting.expectOne((r) => r.url === `${environment.apiUrl}/studies`);
    listReq.flush([makeStudy({ id: 's1' })]);
    fixture.detectChanges();

    (query('[data-testid="delete-study-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const modalCard = query('[role="alertdialog"]');
    expect(modalCard).not.toBeNull();
    expect(modalCard!.getAttribute('aria-modal')).toBe('true');
    expect(modalCard!.getAttribute('aria-labelledby')).toBe('delete-modal-title');
    expect(modalCard!.getAttribute('aria-describedby')).toBe('delete-modal-body');
  });
});
