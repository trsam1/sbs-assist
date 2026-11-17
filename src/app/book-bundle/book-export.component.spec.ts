import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { BookStudy } from '../models';
import { BookBundle, empty, failed } from './book-bundle';
import { BookBundleService } from './book-bundle.service';
import { BookExportComponent } from './book-export.component';
import { DOWNLOAD_FILE, DownloadRequest } from './download';

const BOOK = {
  id: 'b1',
  userId: 'u',
  book: 'Romans',
  title: '',
  notes: 'A note',
  createdAt: '',
  updatedAt: '',
  referents: [],
} as BookStudy;

function bundle(over: Partial<BookBundle> = {}): BookBundle {
  return {
    book: BOOK,
    scroll: empty(),
    wordStudies: empty(),
    antecedents: empty(),
    structure: empty(),
    outline: empty(),
    figures: empty(),
    interrogation: empty(),
    memorization: empty(),
    ...over,
  };
}

@Component({
  selector: 'app-host',
  imports: [BookExportComponent],
  template: `<app-book-export [book]="book" [scrollStudyId]="scrollId()" />`,
})
class HostComponent {
  book = BOOK;
  scrollId = signal('s1');
}

describe('BookExportComponent', () => {
  let loadSpy: ReturnType<typeof vi.fn<(b: BookStudy, id: string) => Observable<BookBundle>>>;
  let downloadSpy: ReturnType<typeof vi.fn<(r: DownloadRequest) => void>>;
  let el: HTMLElement;
  let render: () => void;

  function setup(result: Observable<BookBundle>): void {
    loadSpy = vi.fn<(b: BookStudy, id: string) => Observable<BookBundle>>().mockReturnValue(result);
    downloadSpy = vi.fn<(r: DownloadRequest) => void>();
    TestBed.configureTestingModule({
      providers: [
        { provide: BookBundleService, useValue: { load: loadSpy } },
        { provide: DOWNLOAD_FILE, useValue: downloadSpy },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement as HTMLElement;
    render = () => fixture.detectChanges();
    render();
  }

  beforeEach(() => TestBed.resetTestingModule());

  const click = (id: string) => (el.querySelector(`[data-testid="${id}"]`) as HTMLElement).click();
  const text = (id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

  it('downloads a Markdown document with a dated file name', () => {
    setup(of(bundle()));
    click('export-markdown');
    expect(loadSpy).toHaveBeenCalledWith(BOOK, 's1');
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const req = downloadSpy.mock.calls[0][0];
    expect(req.name).toMatch(/^romans-study-\d{4}-\d{2}-\d{2}\.md$/);
    expect(req.mimeType).toBe('text/markdown');
    expect(req.content).toContain('# Romans');
    expect(req.content).toContain('A note');
  });

  it('downloads a JSON backup with no user id', () => {
    setup(of(bundle()));
    click('export-json');
    const req = downloadSpy.mock.calls[0][0];
    expect(req.name).toMatch(/\.json$/);
    expect(req.mimeType).toBe('application/json');
    const parsed = JSON.parse(req.content);
    expect(parsed.format).toBe('axios-book-export');
    expect(req.content).not.toContain('userId');
  });

  it('leaves the scroll text out until the box is ticked', () => {
    const withScroll = bundle({
      scroll: {
        status: 'loaded',
        data: { id: 's1', status: 'ready', scrollText: 'SCROLLTEXT', bookName: 'Romans' } as never,
      },
    });
    setup(of(withScroll));
    click('export-markdown');
    expect(downloadSpy.mock.calls[0][0].content).not.toContain('SCROLLTEXT');

    click('export-include-scroll');
    render();
    click('export-markdown');
    expect(downloadSpy.mock.calls[1][0].content).toContain('SCROLLTEXT');
  });

  it('still downloads a partial export and says which parts were left out', () => {
    setup(of(bundle({ figures: failed(), interrogation: failed() })));
    click('export-markdown');
    render();
    expect(downloadSpy.mock.calls[0][0].content).toContain('**Not included**');
    expect(text('export-partial')).toContain('Figures of speech, Interrogation');
  });

  it('shows an error and downloads nothing when loading fails', () => {
    setup(throwError(() => new Error('boom')));
    click('export-markdown');
    render();
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(text('export-status')).toContain('could not be created');
  });

  it('passes an empty scroll id when the book has no scroll', () => {
    setup(of(bundle()));
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.scrollId.set('');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="export-markdown"]') as HTMLElement).click();
    expect(loadSpy).toHaveBeenLastCalledWith(BOOK, '');
  });
});
