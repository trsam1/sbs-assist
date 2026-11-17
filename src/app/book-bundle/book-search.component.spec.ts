import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { BookStudy } from '../models';
import { BookBundle, Part, empty, failed } from './book-bundle';
import { BookBundleService } from './book-bundle.service';
import { BookSearchComponent } from './book-search.component';

const loaded = <T>(data: T): Part<T> => ({ status: 'loaded', data });

const BOOK = {
  id: 'b1',
  userId: 'u',
  book: 'Romans',
  title: '',
  notes: 'Remember the Spirit',
  createdAt: '',
  updatedAt: '',
  referents: [],
} as BookStudy;

function bundle(over: Partial<BookBundle> = {}): BookBundle {
  return {
    book: BOOK,
    scroll: loaded({
      id: 's1',
      status: 'ready',
      scrollText: 'the Spirit of life\nno condemnation',
    } as never),
    wordStudies: empty(),
    antecedents: empty(),
    structure: empty(),
    outline: empty(),
    figures: empty(),
    interrogation: loaded({
      entries: [
        {
          question: 'Who is the Spirit?',
          category: 'who',
          tags: [],
          passageRef: '',
          answer: '',
          notes: '',
        },
      ],
    } as never),
    memorization: empty(),
    ...over,
  };
}

@Component({
  selector: 'app-host',
  imports: [BookSearchComponent],
  template: `<app-book-search [book]="book" [scrollStudyId]="scrollId()" />`,
})
class HostComponent {
  book = BOOK;
  scrollId = signal('s1');
}

describe('BookSearchComponent', () => {
  let loadSpy: ReturnType<typeof vi.fn<(b: BookStudy, id: string) => Observable<BookBundle>>>;
  let el: HTMLElement;
  let render: () => void;

  function setup(result: Observable<BookBundle>): void {
    loadSpy = vi.fn<(b: BookStudy, id: string) => Observable<BookBundle>>().mockReturnValue(result);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: BookBundleService, useValue: { load: loadSpy } }],
    });
    const fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement as HTMLElement;
    render = () => fixture.detectChanges();
    render();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });
  afterEach(() => vi.useRealTimers());

  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const input = () => q('book-search-input') as HTMLInputElement;

  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new Event('input'));
  }

  it('does not load anything until something is searched', () => {
    setup(of(bundle()));
    expect(loadSpy).not.toHaveBeenCalled();
    expect(q('book-search')?.getAttribute('role')).toBe('search');
  });

  it('searches after a short pause in typing, loading the book once', () => {
    setup(of(bundle()));
    type('spirit');
    render();
    expect(loadSpy).not.toHaveBeenCalled(); // still debouncing

    vi.advanceTimersByTime(200);
    render();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith(BOOK, 's1');
    expect(q('search-group-notes')).not.toBeNull();
    expect(q('search-group-interrogation')).not.toBeNull();
    expect(q('search-group-scroll')).not.toBeNull();

    type('condemnation');
    vi.advanceTimersByTime(200);
    render();
    expect(loadSpy).toHaveBeenCalledTimes(1); // cached for the visit
    expect(q('search-group-scroll')).not.toBeNull();
    expect(q('search-group-notes')).toBeNull();
  });

  it('searches at once on submit', () => {
    setup(of(bundle()));
    type('spirit');
    (q('book-search') as HTMLFormElement).dispatchEvent(new Event('submit'));
    render();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(q('search-group-notes')).not.toBeNull();
  });

  it('announces the count and highlights matches with <mark>', () => {
    setup(of(bundle()));
    type('spirit');
    vi.advanceTimersByTime(200);
    render();
    expect(q('book-search-status')?.textContent).toMatch(/3 results in 3 places/);
    const marks = Array.from(el.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((m) => m?.toLowerCase() === 'spirit')).toBe(true);
  });

  it('links a result to the page where it can be edited', () => {
    setup(of(bundle()));
    type('who');
    vi.advanceTimersByTime(200);
    render();
    const link = q('search-group-interrogation')?.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/scroll/s1/interrogate');
  });

  it('can leave the scroll out of the search', () => {
    setup(of(bundle()));
    (q('book-search-scroll') as HTMLInputElement).click();
    render();
    type('condemnation');
    vi.advanceTimersByTime(200);
    render();
    expect(q('search-group-scroll')).toBeNull();
    expect(q('book-search-status')?.textContent).toContain('No results');
  });

  it('says so when nothing matches', () => {
    setup(of(bundle()));
    type('zzzz');
    vi.advanceTimersByTime(200);
    render();
    expect(q('book-search-status')?.textContent).toContain('No results for "zzzz"');
  });

  it('runs on what loaded and names the parts that did not', () => {
    setup(of(bundle({ figures: failed(), memorization: failed() })));
    type('spirit');
    vi.advanceTimersByTime(200);
    render();
    expect(q('search-group-notes')).not.toBeNull();
    expect(q('book-search-partial')?.textContent).toContain('Figures of speech, Memorization');
  });

  it('shows an error, and loads again on the next search, when the book cannot be loaded', () => {
    setup(throwError(() => new Error('x')));
    type('spirit');
    vi.advanceTimersByTime(200);
    render();
    expect(q('book-search-error')).not.toBeNull();

    loadSpy.mockReturnValue(of(bundle()));
    (q('book-search') as HTMLFormElement).dispatchEvent(new Event('submit'));
    render();
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(q('book-search-error')).toBeNull();
    expect(q('search-group-notes')).not.toBeNull();
  });

  it('clears the results when the box is cleared', () => {
    setup(of(bundle()));
    type('spirit');
    vi.advanceTimersByTime(200);
    render();
    type('');
    vi.advanceTimersByTime(200);
    render();
    expect(el.querySelectorAll('[data-testid="search-hit"]').length).toBe(0);
    expect(q('book-search-status')?.textContent?.trim()).toBe('');
  });

  it('says how many more results there are past the per-group limit', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `grace ${i}`).join('\n');
    setup(
      of(bundle({ scroll: loaded({ id: 's1', status: 'ready', scrollText: lines } as never) })),
    );
    type('grace');
    vi.advanceTimersByTime(200);
    render();
    expect(
      el.querySelectorAll('[data-testid="search-group-scroll"] [data-testid="search-hit"]').length,
    ).toBe(25);
    expect(q('search-more')?.textContent).toContain('15 more');
  });
});
