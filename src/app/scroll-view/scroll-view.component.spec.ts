import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { ScrollViewComponent } from './scroll-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';

function makeStudy(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookName: 'John',
    status: 'ready',
    scrollText: 'In the beginning was the Word',
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('ScrollViewComponent', () => {
  let fixture: ComponentFixture<ScrollViewComponent>;
  let component: ScrollViewComponent;
  let getSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    getSpy = vi.fn();
    const mockService: Partial<ScrollStudyService> = {
      getScrollStudy: getSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    TestBed.configureTestingModule({
      imports: [ScrollViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: mockService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(ScrollViewComponent);
    component = fixture.componentInstance;
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('renders the ready state with the extracted text', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready' })));
    fixture.detectChanges();

    expect(component.state()).toBe('ready');
    const text = query('[data-testid="scroll-text"]');
    expect(text?.textContent).toContain('In the beginning was the Word');
    expect(query('[data-testid="scroll-book"]')?.textContent).toContain('John');
  });

  it('shows a truncation notice when truncated', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready', truncated: true })));
    fixture.detectChanges();
    expect(query('[data-testid="truncation-notice"]')).not.toBeNull();
  });

  it('renders the failed state with the reason and a re-upload button', () => {
    configure();
    getSpy.mockReturnValue(
      of(makeStudy({ status: 'failed', failureReason: 'file too large', scrollText: '' })),
    );
    fixture.detectChanges();

    expect(component.state()).toBe('failed');
    expect(query('[data-testid="failed"]')?.textContent).toContain('file too large');
    expect(query('[data-testid="reupload-button"]')).not.toBeNull();
  });

  it('uses pre-wrap and a scroll container for the ready text region', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready' })));
    fixture.detectChanges();

    const pre = query('.scroll-text') as HTMLElement;
    expect(getComputedStyle(pre).whiteSpace).toBe('pre-wrap');
  });

  it('shows the processing indicator and polls while extracting', () => {
    vi.useFakeTimers();
    configure();
    getSpy
      .mockReturnValueOnce(of(makeStudy({ status: 'extracting' })))
      .mockReturnValueOnce(of(makeStudy({ status: 'ready' })));

    fixture.detectChanges();
    expect(component.state()).toBe('processing');
    expect(query('[data-testid="processing"]')).not.toBeNull();

    // Advance past one poll interval → second fetch returns ready.
    vi.advanceTimersByTime(3000);
    fixture.detectChanges();
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(component.state()).toBe('ready');
  });

  it('stops polling once status is terminal', () => {
    vi.useFakeTimers();
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready' })));
    fixture.detectChanges();

    vi.advanceTimersByTime(30000);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a timeout message after the bounded number of polls', () => {
    vi.useFakeTimers();
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'extracting' })));
    fixture.detectChanges();

    // 20 poll intervals should exhaust the bound and stop polling.
    for (let i = 0; i < 21; i++) {
      vi.advanceTimersByTime(3000);
    }
    fixture.detectChanges();
    expect(component.state()).toBe('timeout');
    expect(query('[data-testid="timeout"]')).not.toBeNull();
  });

  it('shows an error state with retry on load failure', () => {
    configure();
    getSpy.mockReturnValue(throwError(() => new Error('boom')));
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    expect(query('[data-testid="error"]')).not.toBeNull();
  });

  it('navigates to /scroll/new on re-upload', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'failed', failureReason: 'x' })));
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');
    (query('[data-testid="reupload-button"]') as HTMLButtonElement).click();
    expect(navigateSpy).toHaveBeenCalledWith(['/scroll/new']);
  });
});
