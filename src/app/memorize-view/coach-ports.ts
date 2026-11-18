/**
 * Browser pieces for audio coaching: speech, tone, silence detection, wake lock and media keys. The logic
 * that can be tested without a browser (`chunkForSpeech`, `estimateSpeechMs`, `SilenceDetector`) is pure and
 * exported; the rest is a thin wrapper over the platform API and is replaced in tests.
 */
import { InjectionToken } from '@angular/core';

// --- pure helpers ---------------------------------------------------------------------------------

/**
 * Split text into pieces that are safe to hand to the speech engine one at a time. Some engines silently
 * stop an utterance after about 15 seconds, so long text is spoken sentence by sentence, and a sentence
 * that is still long is split at commas, then at a word boundary.
 */
export function chunkForSpeech(text: string, maxChars = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const pieces: string[] = [];
  for (const sentence of clean.split(/(?<=[.!?])\s+/u)) {
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    let current = '';
    for (const part of sentence.split(/(?<=[,;:])\s+/u)) {
      if ((current + ' ' + part).trim().length <= maxChars) {
        current = (current + ' ' + part).trim();
        continue;
      }
      if (current) pieces.push(current);
      current = part;
      while (current.length > maxChars) {
        const cut = current.lastIndexOf(' ', maxChars);
        const at = cut > 0 ? cut : maxChars;
        pieces.push(current.slice(0, at).trim());
        current = current.slice(at).trim();
      }
    }
    if (current) pieces.push(current);
  }
  return pieces.filter((p) => p.length > 0);
}

/** A generous guess at how long `text` takes to say, used only to catch engines that never report the end. */
export function estimateSpeechMs(text: string, rate: number): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const perWord = 450 / Math.max(0.5, rate);
  return Math.round(wordCount * perWord + 3000);
}

/** Root-mean-square level of audio samples in [-1, 1] (0 for none). */
export function rms(samples: Float32Array | readonly number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.sqrt(sum / samples.length);
}

export type SilenceEvent = 'speech-started' | 'silence' | 'no-speech';

export interface SilenceOptions {
  /** Level above which the student counts as speaking. */
  threshold: number;
  /** Quiet for this long after speech began ends the recitation. */
  silenceMs: number;
  /** If speech never starts within this long, give up. */
  noSpeechMs: number;
}

export const DEFAULT_SILENCE: SilenceOptions = {
  threshold: 0.02,
  silenceMs: 2500,
  noSpeechMs: 12000,
};

/**
 * Decides when a recitation has ended from a stream of loudness readings. Pure: feed it (level, time) and it
 * reports the first event that matters. Silence only counts once speech has started, so a pause before the
 * first word never ends the recording early.
 */
export class SilenceDetector {
  private speaking = false;
  private lastLoud: number;
  private done = false;

  constructor(
    private readonly opts: SilenceOptions,
    private readonly startedAt: number,
  ) {
    this.lastLoud = startedAt;
  }

  feed(level: number, now: number): SilenceEvent | null {
    if (this.done) return null;
    if (level >= this.opts.threshold) {
      this.lastLoud = now;
      if (!this.speaking) {
        this.speaking = true;
        return 'speech-started';
      }
      return null;
    }
    if (this.speaking && now - this.lastLoud >= this.opts.silenceMs) {
      this.done = true;
      return 'silence';
    }
    if (!this.speaking && now - this.startedAt >= this.opts.noSpeechMs) {
      this.done = true;
      return 'no-speech';
    }
    return null;
  }
}

// --- feature checks -------------------------------------------------------------------------------

export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  );
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

// --- speech ---------------------------------------------------------------------------------------

/** Installed voices. They load asynchronously, so this waits briefly for the list to fill. */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', done);
    setTimeout(done, 1500);
  });
}

export interface SpeakerOptions {
  rate: () => number;
  voiceName: () => string;
}

/** Speaks text piece by piece. Resolves when done, rejects with an Error on a real failure. */
export function createSpeaker(opts: SpeakerOptions): {
  speak(text: string): Promise<void>;
  cancel(): void;
} {
  let cancelled = false;
  return {
    async speak(text: string): Promise<void> {
      if (!speechSupported()) throw new Error('Speech is not available in this browser.');
      cancelled = false;
      for (const piece of chunkForSpeech(text)) {
        if (cancelled) return;
        await speakPiece(piece, opts.rate(), opts.voiceName(), () => cancelled);
      }
    },
    cancel(): void {
      cancelled = true;
      if (speechSupported()) window.speechSynthesis.cancel();
    },
  };
}

function speakPiece(
  text: string,
  rate: number,
  voiceName: string,
  isCancelled: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    if (voiceName) {
      const v = synth.getVoices().find((x) => x.name === voiceName);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
    }
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (err && !isCancelled()) reject(err);
      else resolve();
    };
    // Some engines never fire `end`. Resolve after a generous estimate instead of hanging the session.
    const watchdog = setTimeout(() => finish(), estimateSpeechMs(text, rate));
    u.onend = () => finish();
    u.onerror = (e) => {
      const code = (e as SpeechSynthesisErrorEvent).error;
      // 'canceled' / 'interrupted' are our own cancel(); anything else is a real failure.
      if (code === 'canceled' || code === 'interrupted') finish();
      else finish(new Error(`Speech failed (${code || 'unknown'}).`));
    };
    synth.speak(u);
  });
}

// --- tone -----------------------------------------------------------------------------------------

/** A short, soft beep that marks "now". Resolves when it has played. Silent where audio is unavailable. */
export function playTone(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return resolve();
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
      osc.onended = () => {
        void ctx.close();
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

// --- silence watcher ------------------------------------------------------------------------------

/**
 * Watch a microphone stream and call `onEvent('silence' | 'no-speech')` when the recitation ends. Returns a
 * function that stops watching and releases the audio context.
 */
export function watchSilence(
  stream: MediaStream,
  opts: Partial<SilenceOptions>,
  onEvent: (e: 'silence' | 'no-speech') => void,
): () => void {
  const options: SilenceOptions = { ...DEFAULT_SILENCE, ...opts };
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => undefined;

  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const detector = new SilenceDetector(options, performance.now());

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    const event = detector.feed(rms(buffer), performance.now());
    if (event === 'silence' || event === 'no-speech') {
      stop();
      onEvent(event);
    }
  }, 100);

  function stop(): void {
    clearInterval(timer);
    try {
      source.disconnect();
      void ctx.close();
    } catch {
      /* already closed */
    }
  }
  return stop;
}

// --- keep the screen awake and answer media keys --------------------------------------------------

export interface MediaKeyHandlers {
  onPlay(): void;
  onPause(): void;
  onNext(): void;
}

/** Keeps the screen on during a session and routes headset or steering-wheel buttons to the coach. */
export function createKeepalive(): {
  acquire(title: string, handlers: MediaKeyHandlers): Promise<void>;
  release(): void;
} {
  let lock: WakeLockSentinel | null = null;
  let onVisible: (() => void) | null = null;

  const request = async (): Promise<void> => {
    if (!wakeLockSupported()) return;
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {
      lock = null; // not allowed right now (low battery, background tab); the session still works
    }
  };

  return {
    async acquire(title, handlers): Promise<void> {
      await request();
      // A wake lock is released when the tab is hidden; take it again when the student comes back.
      onVisible = () => {
        if (document.visibilityState === 'visible' && !lock) void request();
      };
      document.addEventListener('visibilitychange', onVisible);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: 'Axios Bible Study Tools',
        });
        const set = (action: MediaSessionAction, fn: () => void) => {
          try {
            navigator.mediaSession.setActionHandler(action, fn);
          } catch {
            /* action not supported here */
          }
        };
        set('play', handlers.onPlay);
        set('pause', handlers.onPause);
        set('nexttrack', handlers.onNext);
      }
    },
    release(): void {
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
      onVisible = null;
      void lock?.release().catch(() => undefined);
      lock = null;
      if ('mediaSession' in navigator) {
        for (const a of ['play', 'pause', 'nexttrack'] as MediaSessionAction[]) {
          try {
            navigator.mediaSession.setActionHandler(a, null);
          } catch {
            /* ignore */
          }
        }
        navigator.mediaSession.metadata = null;
      }
    },
  };
}

/** Injected so tests can replace the microphone-based silence watcher. */
export const SILENCE_WATCHER = new InjectionToken<typeof watchSilence>('SILENCE_WATCHER', {
  providedIn: 'root',
  factory: () => watchSilence,
});
