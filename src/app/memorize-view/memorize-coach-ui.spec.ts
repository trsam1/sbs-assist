import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_COACH_PREFS } from './coach-plan';
import { MemorizeCoach, CoachMode } from './memorize-coach';
import { MemorizeCoachBarComponent } from './memorize-coach-bar.component';
import { MemorizeCoachControlsComponent } from './memorize-coach-controls.component';
import { MemorizeStore } from './memorize-store';
import { MemorizeTest } from './memorize-test.service';

function fakeCoach(over: { supported?: boolean; mode?: CoachMode } = {}) {
  return {
    supported: over.supported ?? true,
    mode: signal<CoachMode>(over.mode ?? 'off'),
    label: signal('Phrase 2 of 5'),
    progress: signal('Step 4 of 20'),
    paused: signal(false),
    notice: signal(''),
    prefs: signal({ ...DEFAULT_COACH_PREFS }),
    voices: signal<{ name: string; lang: string }[]>([]),
    startLearn: vi.fn(),
    startTest: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    skip: vi.fn(),
    repeat: vi.fn(),
    hearIt: vi.fn(),
    stop: vi.fn(),
    setPrefs: vi.fn(),
    ensureVoices: vi.fn(),
  };
}

const fakeStore = (over: { chunk?: boolean; deckDone?: boolean; rec?: boolean } = {}) => ({
  learnChunk: () => (over.chunk === false ? null : { verseRef: '1:1' }),
  deckComplete: () => over.deckDone ?? false,
});

describe('MemorizeCoachBarComponent', () => {
  let coach: ReturnType<typeof fakeCoach>;
  let el: HTMLElement;
  let render: () => void;

  function setup(over: Parameters<typeof fakeCoach>[0] = {}): void {
    coach = fakeCoach(over);
    TestBed.configureTestingModule({ providers: [{ provide: MemorizeCoach, useValue: coach }] });
    const fixture = TestBed.createComponent(MemorizeCoachBarComponent);
    el = fixture.nativeElement as HTMLElement;
    render = () => fixture.detectChanges();
    render();
  }

  beforeEach(() => TestBed.resetTestingModule());
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('is hidden when no session is running', () => {
    setup();
    expect(q('coach-bar')).toBeNull();
  });

  it('shows what the coach is doing, in words, and the progress', () => {
    setup({ mode: 'learn' });
    expect(q('coach-label')?.textContent).toContain('Phrase 2 of 5');
    expect(q('coach-progress')?.textContent).toContain('Step 4 of 20');
    expect(q('coach-bar')?.getAttribute('role')).toBe('region');
  });

  it('wires Pause, Repeat, Skip and Stop', () => {
    setup({ mode: 'learn' });
    q('coach-pause')?.click();
    q('coach-repeat')?.click();
    q('coach-skip')?.click();
    q('coach-stop')?.click();
    expect(coach.pause).toHaveBeenCalled();
    expect(coach.repeat).toHaveBeenCalled();
    expect(coach.skip).toHaveBeenCalled();
    expect(coach.stop).toHaveBeenCalled();
    expect(q('coach-hear-it')).toBeNull(); // Test coach only
  });

  it('swaps Pause for Resume while paused, and says so', () => {
    setup({ mode: 'learn' });
    coach.paused.set(true);
    render();
    expect(q('coach-pause')).toBeNull();
    expect(q('coach-label')?.textContent).toContain('Paused.');
    q('coach-resume')?.click();
    expect(coach.resume).toHaveBeenCalled();
  });

  it('offers "Hear it" only in the Test coach', () => {
    setup({ mode: 'test' });
    q('coach-hear-it')?.click();
    expect(coach.hearIt).toHaveBeenCalled();
  });

  it('shows an error notice as an alert', () => {
    setup({ mode: 'learn' });
    coach.notice.set('Speech failed. Tap Resume to try again.');
    render();
    expect(q('coach-notice')?.getAttribute('role')).toBe('alert');
    expect(q('coach-notice')?.textContent).toContain('Speech failed');
  });

  it('shows how a finished session ended once the bar is gone', () => {
    setup();
    coach.notice.set('Finished. Tap "Got it" when you have this verse.');
    render();
    expect(q('coach-notice-idle')?.textContent).toContain('Got it');
  });
});

describe('MemorizeCoachControlsComponent', () => {
  @Component({
    selector: 'app-host',
    imports: [MemorizeCoachControlsComponent],
    template: `<app-memorize-coach-controls [kind]="kind()" />`,
  })
  class HostComponent {
    kind = signal<'learn' | 'test'>('learn');
  }

  let coach: ReturnType<typeof fakeCoach>;
  let host: HostComponent;
  let el: HTMLElement;
  let render: () => void;

  function setup(
    coachOver: Parameters<typeof fakeCoach>[0] = {},
    storeOver: Parameters<typeof fakeStore>[0] = {},
  ): void {
    coach = fakeCoach(coachOver);
    TestBed.configureTestingModule({
      providers: [
        { provide: MemorizeCoach, useValue: coach },
        { provide: MemorizeStore, useValue: fakeStore(storeOver) },
        { provide: MemorizeTest, useValue: { recordingSupported: () => storeOver.rec ?? true } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    render = () => fixture.detectChanges();
    render();
  }

  beforeEach(() => TestBed.resetTestingModule());
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

  it('explains itself and offers nothing when the browser cannot speak', () => {
    setup({ supported: false });
    expect(q('coach-unsupported')).not.toBeNull();
    expect(q('coach-start-learn')).toBeNull();
  });

  it('starts the Learn coach from "Coach me"', () => {
    setup();
    q('coach-start-learn')?.click();
    expect(coach.startLearn).toHaveBeenCalled();
    expect(q('coach-start-test')).toBeNull();
  });

  it('disables "Coach me" while a session runs or when no chunk is chosen', () => {
    setup({ mode: 'learn' });
    expect(q('coach-start-learn')?.disabled).toBe(true);
    TestBed.resetTestingModule();
    setup({}, { chunk: false });
    expect(q('coach-start-learn')?.disabled).toBe(true);
  });

  it('starts the Test coach from "Coach test"', () => {
    setup();
    host.kind.set('test');
    render();
    q('coach-start-test')?.click();
    expect(coach.startTest).toHaveBeenCalled();
  });

  it('disables "Coach test" when the deck is done or the browser cannot record', () => {
    setup({}, { deckDone: true });
    host.kind.set('test');
    render();
    expect(q('coach-start-test')?.disabled).toBe(true);
    TestBed.resetTestingModule();
    setup({}, { rec: false });
    host.kind.set('test');
    render();
    expect(q('coach-start-test')?.disabled).toBe(true);
  });

  it('saves settings as they change and loads the voice list when opened', () => {
    setup();
    const rate = q('coach-rate') as unknown as HTMLInputElement;
    rate.value = '0.8';
    rate.dispatchEvent(new Event('input'));
    expect(coach.setPrefs).toHaveBeenCalledWith({ rate: 0.8 });

    (q('coach-tones') as unknown as HTMLInputElement).click();
    expect(coach.setPrefs).toHaveBeenCalledWith({ tones: false });

    el.querySelector('details')?.dispatchEvent(new Event('toggle'));
    expect(coach.ensureVoices).toHaveBeenCalled();
  });

  it('shows the silence setting only for the Test coach', () => {
    setup();
    expect(q('coach-silence-ms')).toBeNull();
    host.kind.set('test');
    render();
    expect(q('coach-silence-ms')).not.toBeNull();
  });
});
