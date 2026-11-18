import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BlbRefDirective } from './blb-ref.directive';
import { BlbTaggerService, BLB_SCRIPT_URL, BLB_TRANSLATION } from './blb-tagger.service';

@Component({
  imports: [BlbRefDirective],
  template: `<div
    class="outer"
    (click)="outerClicks = outerClicks + 1"
    (keyup)="(0)"
    tabindex="0"
    role="button"
  >
    <strong data-testid="ref" [appBlbRef]="ref()"></strong>
  </div>`,
})
class HostComponent {
  readonly ref = signal('Romans 5:8');
  outerClicks = 0;
}

describe('BlbRefDirective', () => {
  const tag = vi.fn(async () => undefined);

  beforeEach(() => {
    tag.mockClear();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: BlbTaggerService, useValue: { tag } }],
    });
  });

  it('renders the reference as text and asks the tagger to tag it', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('[data-testid="ref"]') as HTMLElement;
    expect(el.textContent).toBe('Romans 5:8');
    expect(tag).toHaveBeenCalledWith(el);
  });

  it('re-renders and re-tags when the reference changes', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    fixture.componentInstance.ref.set('John 3:16');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('[data-testid="ref"]') as HTMLElement;
    expect(el.textContent).toBe('John 3:16');
    expect(tag).toHaveBeenCalledTimes(2);
  });

  it('does not let a click on the generated link reach a parent handler', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('[data-testid="ref"]') as HTMLElement;
    // Simulate the vendor script replacing the text with a link.
    el.innerHTML = '<a href="https://www.blueletterbible.org/">Romans 5:8</a>';
    el.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.outerClicks).toBe(0);
    // A click on plain text (no link) still bubbles, so the row can toggle.
    el.textContent = 'Romans 5:8';
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.outerClicks).toBe(1);
  });
});

describe('BlbTaggerService', () => {
  beforeEach(() => {
    document.querySelectorAll(`script[src="${BLB_SCRIPT_URL}"]`).forEach((s) => s.remove());
    const w = window as unknown as Record<string, unknown>;
    delete w['BLB'];
    delete w['YAHOO'];
    TestBed.configureTestingModule({});
  });

  function scriptEl(): HTMLScriptElement | null {
    return document.querySelector(`script[src="${BLB_SCRIPT_URL}"]`);
  }

  it('does not load the script until something needs it', () => {
    TestBed.inject(BlbTaggerService);
    expect(scriptEl()).toBeNull();
  });

  it('loads the script once, configures the tagger, and tags the element', async () => {
    const walk = vi.fn();
    const svc = TestBed.inject(BlbTaggerService);
    const el = document.createElement('span');
    document.body.appendChild(el);

    const p1 = svc.tag(el);
    const p2 = svc.tag(el);
    expect(document.querySelectorAll(`script[src="${BLB_SCRIPT_URL}"]`).length).toBe(1);

    const w = window as unknown as Record<string, unknown>;
    w['YAHOO'] = { util: { Dom: {} } };
    w['BLB'] = { Tagger: { walkDomTree: walk } };
    scriptEl()!.onload?.(new Event('load'));
    await Promise.all([p1, p2]);

    expect(walk).toHaveBeenCalledTimes(2);
    expect(walk).toHaveBeenCalledWith(el);
    const tagger = (w['BLB'] as { Tagger: Record<string, unknown> }).Tagger;
    expect(tagger['Translation']).toBe(BLB_TRANSLATION);
    expect(tagger['TargetNewWindow']).toBe(true);
    el.remove();
  });

  it('leaves the plain text alone when the script cannot load, and allows a retry', async () => {
    const svc = TestBed.inject(BlbTaggerService);
    const el = document.createElement('span');
    el.textContent = 'Romans 5:8';
    document.body.appendChild(el);

    const p = svc.tag(el);
    scriptEl()!.onerror?.(new Event('error'));
    await p;
    expect(el.textContent).toBe('Romans 5:8');
    expect(scriptEl()).toBeNull();

    void svc.tag(el); // a later attempt tries again
    expect(scriptEl()).not.toBeNull();
    scriptEl()!.onerror?.(new Event('error'));
    el.remove();
  });

  it('survives a vendor scanner that throws', async () => {
    const svc = TestBed.inject(BlbTaggerService);
    const el = document.createElement('span');
    document.body.appendChild(el);
    const p = svc.tag(el);
    const w = window as unknown as Record<string, unknown>;
    w['YAHOO'] = { util: { Dom: {} } };
    w['BLB'] = {
      Tagger: {
        walkDomTree: () => {
          throw new Error('vendor bug');
        },
      },
    };
    scriptEl()!.onload?.(new Event('load'));
    await expect(p).resolves.toBeUndefined();
    el.remove();
  });
});
