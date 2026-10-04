import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { PronounViewComponent } from './pronoun-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';

function makeStudy(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookName: 'John',
    status: 'ready',
    scrollText: 'He saw them, and they saw him.',
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('PronounViewComponent', () => {
  let fixture: ComponentFixture<PronounViewComponent>;
  let component: PronounViewComponent;
  let getSpy: ReturnType<typeof vi.fn>;
  let mockService: Partial<ScrollStudyService>;

  function configure(): void {
    getSpy = vi.fn();
    mockService = {
      getScrollStudy: getSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    TestBed.configureTestingModule({
      imports: [PronounViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: mockService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(PronounViewComponent);
    component = fixture.componentInstance;
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function queryAll(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the pronoun list, counts, and totals for a ready study', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready' })));
    fixture.detectChanges();

    expect(component.state()).toBe('ready');
    const rows = queryAll('[data-testid="pronoun-row"]');
    // he:1, him:1, them:1, they:1 → 4 distinct, 4 occurrences
    expect(rows).toHaveLength(4);
    const words = queryAll('[data-testid="pronoun-word"]').map((e) => e.textContent?.trim());
    expect(words).toEqual(['he', 'him', 'them', 'they']);
    const totals = query('[data-testid="pronoun-totals"]')?.textContent ?? '';
    expect(totals).toContain('4 distinct');
    expect(totals).toContain('4 total');
  });

  it('shows the empty state when the scroll has no pronouns', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready', scrollText: 'In the beginning' })));
    fixture.detectChanges();

    expect(query('[data-testid="pronoun-empty"]')).not.toBeNull();
    expect(query('[data-testid="pronoun-list"]')).toBeNull();
  });

  it('surfaces the truncation note for a truncated ready study', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready', truncated: true })));
    fixture.detectChanges();
    expect(query('[data-testid="pronoun-truncation"]')).not.toBeNull();
  });

  it('shows the preparing notification with a back link to the scroll for an extracting study', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'extracting', scrollText: '' })));
    fixture.detectChanges();

    expect(component.state()).toBe('preparing');
    expect(query('[data-testid="pronoun-preparing"]')).not.toBeNull();
    expect(query('[data-testid="pronoun-list"]')).toBeNull();
    const back = query('[data-testid="pronoun-preparing-back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/scroll/s1');
  });

  it('shows the preparing notification for an uploading study', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'uploading', scrollText: '' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
  });

  it('shows the failed notification with the reason and a back link to /scrolls', () => {
    configure();
    getSpy.mockReturnValue(
      of(makeStudy({ status: 'failed', failureReason: 'file too large', scrollText: '' })),
    );
    fixture.detectChanges();

    expect(component.state()).toBe('failed');
    expect(query('[data-testid="pronoun-failed"]')?.textContent).toContain('file too large');
    const back = query('[data-testid="pronoun-failed-back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/scrolls');
  });

  it('treats a 404 as a terminal failed state', () => {
    configure();
    getSpy.mockReturnValue(throwError(() => ({ status: 404 })));
    fixture.detectChanges();

    expect(component.state()).toBe('failed');
    expect(query('[data-testid="pronoun-failed"]')?.textContent).toContain(
      'This scroll could not be found.',
    );
  });

  it('treats a non-404 load failure as a recoverable error with a working Retry', () => {
    configure();
    getSpy
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValueOnce(of(makeStudy({ status: 'ready' })));
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    (query('[data-testid="pronoun-retry-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(component.state()).toBe('ready');
  });

  it('defaults the highlight toggle off and renders plain text until toggled on', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready' })));
    fixture.detectChanges();

    const toggle = query('[data-testid="highlight-toggle"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(query('[data-testid="pronoun-highlighted-text"]')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    expect(component.highlight()).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const highlighted = query('[data-testid="pronoun-highlighted-text"]');
    expect(highlighted).not.toBeNull();
    expect(highlighted?.querySelector('.pronoun-mark')).not.toBeNull();
  });

  it('renders highlighted text whose stripped content equals the scroll text', () => {
    const scrollText = 'He said <it> & they: "she".';
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready', scrollText })));
    fixture.detectChanges();

    (query('[data-testid="highlight-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const highlighted = query('[data-testid="pronoun-highlighted-text"]');
    expect(highlighted?.textContent).toBe(scrollText);
  });

  it('calls getScrollStudy exactly once and issues no other service calls', () => {
    configure();
    getSpy.mockReturnValue(of(makeStudy({ status: 'ready' })));
    fixture.detectChanges();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('s1');
    // The stubbed service exposes only getScrollStudy; assert nothing else is wired in.
    expect(Object.keys(mockService)).toEqual(['getScrollStudy']);
  });
});
