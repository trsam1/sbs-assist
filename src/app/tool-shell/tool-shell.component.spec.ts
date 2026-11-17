import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { ScrollStudy } from '../scroll-study.service';
import { ScrollToolContext, ScrollToolState } from './scroll-tool-context';
import { ToolShellComponent } from './tool-shell.component';

class FakeContext {
  readonly study = signal<ScrollStudy | null>(null);
  readonly state = signal<ScrollToolState>('loading');
  retried = 0;
  retry(): void {
    this.retried++;
  }
  failedMessage(): string {
    return 'Nope';
  }
}

@Component({
  selector: 'app-host',
  imports: [ToolShellComponent],
  template: `<app-tool-shell [stepId]="stepId" [ctx]="ctx" scrollId="s1"
    ><p data-testid="content">Hello</p></app-tool-shell
  >`,
})
class HostComponent {
  stepId = 'structure';
  ctx = new FakeContext() as unknown as ScrollToolContext;
}

function study(over: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u',
    bookStudyId: 'b1',
    bookName: 'Jude',
    status: 'ready',
    scrollText: '',
    truncated: false,
    failureReason: '',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('ToolShellComponent', () => {
  let host: HostComponent;
  let fake: FakeContext;
  let el: HTMLElement;
  let render: () => void;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fake = host.ctx as unknown as FakeContext;
    el = fixture.nativeElement as HTMLElement;
    render = () => fixture.detectChanges();
    render();
  });

  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`);

  it('shows the loading panel and hides content while loading', () => {
    expect(q('tool-loading')).toBeTruthy();
    expect(q('content')).toBeNull();
  });

  it('projects content only when ready', () => {
    fake.study.set(study());
    fake.state.set('ready');
    render();
    expect(q('content')?.textContent).toContain('Hello');
    expect(q('tool-loading')).toBeNull();
  });

  it('heads the page with book and step label', () => {
    fake.study.set(study());
    fake.state.set('ready');
    render();
    expect(q('tool-heading')?.textContent).toContain('Jude — Step 7 — Structure of the Book');
  });

  it('links the first crumb to the book when the scroll has one', () => {
    fake.study.set(study());
    fake.state.set('ready');
    render();
    expect(q('tool-crumb-book')?.getAttribute('href')).toBe('/books/b1');
  });

  it('falls back to the scroll list for a legacy scroll', () => {
    fake.study.set(study({ bookStudyId: '' }));
    fake.state.set('ready');
    render();
    expect(q('tool-crumb-book')).toBeNull();
    expect(q('tool-crumb-scrolls')?.getAttribute('href')).toBe('/scrolls');
  });

  it('offers previous and next steps when ready', () => {
    fake.study.set(study());
    fake.state.set('ready');
    render();
    expect(q('tool-prev')?.getAttribute('href')).toBe('/scroll/s1/antecedents');
    expect(q('tool-next')?.getAttribute('href')).toBe('/scroll/s1/outline');
  });

  it('shows the preparing panel with a link back to the scroll', () => {
    fake.state.set('preparing');
    render();
    expect(q('tool-preparing')).toBeTruthy();
    expect(q('tool-preparing-back')?.getAttribute('href')).toBe('/scroll/s1');
    expect(q('content')).toBeNull();
  });

  it('shows the failed panel with the reason and a way back', () => {
    fake.study.set(study());
    fake.state.set('failed');
    render();
    expect(q('tool-failed')?.textContent).toContain('Nope');
    expect(q('tool-failed-back')?.getAttribute('href')).toBe('/books/b1');
  });

  it('shows the error panel and retries', () => {
    fake.state.set('error');
    render();
    (q('tool-retry') as HTMLButtonElement).click();
    expect(fake.retried).toBe(1);
  });
});
