import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { ScrollToolContext } from './scroll-tool-context';

function scroll(over: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u',
    bookStudyId: 'b1',
    bookName: 'Jude',
    status: 'ready',
    scrollText: 'text',
    truncated: false,
    failureReason: '',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('ScrollToolContext', () => {
  let get: ReturnType<typeof vi.fn<(id: string) => Observable<ScrollStudy>>>;
  let ctx: ScrollToolContext;

  beforeEach(() => {
    get = vi.fn<(id: string) => Observable<ScrollStudy>>();
    TestBed.configureTestingModule({
      providers: [
        ScrollToolContext,
        { provide: ScrollStudyService, useValue: { getScrollStudy: get } },
      ],
    });
    ctx = TestBed.inject(ScrollToolContext);
  });

  it('starts in loading', () => {
    expect(ctx.state()).toBe('loading');
  });

  it('goes ready, exposes the study, and runs the hooks in order', () => {
    get.mockReturnValue(of(scroll()));
    const calls: string[] = [];
    ctx.load('s1', {
      onStart: () => calls.push('start'),
      onReady: (s) => calls.push(`ready:${s.scrollText}`),
    });
    expect(ctx.state()).toBe('ready');
    expect(ctx.study()?.bookName).toBe('Jude');
    expect(calls).toEqual(['start', 'ready:text']);
  });

  it('goes failed for a failed scroll and explains why', () => {
    get.mockReturnValue(of(scroll({ status: 'failed', failureReason: 'Bad file' })));
    ctx.load('s1');
    expect(ctx.state()).toBe('failed');
    expect(ctx.failedMessage()).toBe('Bad file');
  });

  it('uses a default message when a failed scroll has no reason', () => {
    get.mockReturnValue(of(scroll({ status: 'failed' })));
    ctx.load('s1');
    expect(ctx.failedMessage()).toBe('This scroll could not be prepared.');
  });

  it('goes preparing while the scroll is uploading or extracting', () => {
    for (const status of ['uploading', 'extracting'] as const) {
      get.mockReturnValue(of(scroll({ status })));
      ctx.load('s1');
      expect(ctx.state()).toBe('preparing');
    }
  });

  it('treats a 404 as failed and says the scroll was not found', () => {
    get.mockReturnValue(throwError(() => ({ status: 404 })));
    ctx.load('s1');
    expect(ctx.state()).toBe('failed');
    expect(ctx.failedMessage()).toBe('This scroll could not be found.');
  });

  it('treats other errors as error, and retry reloads with the same id and hooks', () => {
    get.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    const onReady = vi.fn();
    ctx.load('s1', { onReady });
    expect(ctx.state()).toBe('error');
    expect(onReady).not.toHaveBeenCalled();

    get.mockReturnValueOnce(of(scroll()));
    ctx.retry();
    expect(get).toHaveBeenLastCalledWith('s1');
    expect(ctx.state()).toBe('ready');
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
