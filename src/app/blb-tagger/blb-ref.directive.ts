import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { BlbTaggerService } from './blb-tagger.service';

/**
 * Renders a verse reference (e.g. "Romans 5:8") as text and asks Blue Letter Bible's tagger to
 * turn it into a hover link. The host's text is set here, not by an Angular binding, because the
 * vendor script replaces the text node; Angular must not own that node.
 *
 * Clicks and Enter on the generated link are stopped so they do not also toggle a parent
 * header (the cross-reference row is itself a button).
 */
@Directive({
  selector: '[appBlbRef]',
  host: {
    '(click)': 'onInteract($event)',
    '(keydown.enter)': 'onInteract($event)',
  },
})
export class BlbRefDirective {
  readonly appBlbRef = input.required<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tagger = inject(BlbTaggerService);

  constructor() {
    effect(() => {
      const el = this.host.nativeElement;
      el.textContent = this.appBlbRef();
      void this.tagger.tag(el);
    });
  }

  onInteract(event: Event): void {
    if ((event.target as HTMLElement | null)?.closest('a')) {
      event.stopPropagation();
    }
  }
}
