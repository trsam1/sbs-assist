import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * Blue Letter Bible "ScriptTagger" (https://www.blueletterbible.org/webtools/BLB_ScriptTagger.cfm).
 *
 * It turns Bible references in the page into links with a hover that shows the verse text,
 * served by Blue Letter Bible. The app itself never stores or serves that text. The script is
 * third-party code that runs on this origin, so it is loaded only when a page that needs it
 * first renders a reference, never at startup.
 *
 * The vendor script scans the DOM once at load. `tag()` re-runs its scanner on one element so
 * references rendered later (Angular views) still get tagged.
 */
export const BLB_SCRIPT_URL =
  'https://www.blueletterbible.org/assets/scripts/blbToolTip/BLB_ScriptTagger-min.js';

/** Translation shown on hover. Any code from BLB's translation list. */
export const BLB_TRANSLATION = 'NASB20';

interface BlbTagger {
  Translation?: string;
  TargetNewWindow?: boolean;
  HideTanslationAbbrev?: boolean;
  walkDomTree?: (node: Node) => void;
}

interface BlbWindow extends Window {
  BLB?: { Tagger?: BlbTagger };
}

@Injectable({ providedIn: 'root' })
export class BlbTaggerService {
  private readonly doc = inject(DOCUMENT);
  private loading: Promise<boolean> | null = null;

  /** Resolves true once the vendor scanner is ready, false if it could not load. */
  load(): Promise<boolean> {
    this.loading ??= new Promise<boolean>((resolve) => {
      const win = this.doc.defaultView as BlbWindow | null;
      if (!win) {
        resolve(false);
        return;
      }
      const script = this.doc.createElement('script');
      script.src = BLB_SCRIPT_URL;
      script.async = true;
      script.onerror = () => {
        script.remove();
        this.loading = null; // allow a later retry
        resolve(false);
      };
      script.onload = () => this.whenReady(win, resolve, 0);
      this.doc.body.appendChild(script);
    });
    return this.loading;
  }

  /** The vendor script finishes initialising asynchronously (it loads more scripts itself). */
  private whenReady(win: BlbWindow, resolve: (ok: boolean) => void, attempt: number): void {
    const tagger = win.BLB?.Tagger;
    if (tagger?.walkDomTree && this.hasDom(win)) {
      tagger.Translation = BLB_TRANSLATION;
      tagger.TargetNewWindow = true;
      tagger.HideTanslationAbbrev = true;
      resolve(true);
    } else if (attempt >= 100) {
      resolve(false);
    } else {
      setTimeout(() => this.whenReady(win, resolve, attempt + 1), 100);
    }
  }

  /** The scanner needs the YUI Dom helper the vendor script loads for itself. */
  private hasDom(win: BlbWindow): boolean {
    const yahoo = (win as unknown as { YAHOO?: { util?: { Dom?: unknown } } }).YAHOO;
    return !!yahoo?.util?.Dom;
  }

  /** Tag the references inside `el`. Safe to call repeatedly; a no-op if the script is absent. */
  async tag(el: HTMLElement): Promise<void> {
    if (!(await this.load())) return;
    const walk = (this.doc.defaultView as BlbWindow | null)?.BLB?.Tagger?.walkDomTree;
    if (walk && el.isConnected) {
      try {
        walk(el);
      } catch {
        // A vendor failure must never break the worksheet; the plain reference text remains.
      }
    }
  }
}
