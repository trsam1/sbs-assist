import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SILENCE,
  SilenceDetector,
  chunkForSpeech,
  estimateSpeechMs,
  rms,
} from './coach-ports';

describe('chunkForSpeech', () => {
  it('keeps a short text as one piece', () => {
    expect(chunkForSpeech('Jesus wept.')).toEqual(['Jesus wept.']);
  });

  it('splits at sentence ends', () => {
    expect(chunkForSpeech('In the beginning. Was the Word? And God!')).toEqual([
      'In the beginning.',
      'Was the Word?',
      'And God!',
    ]);
  });

  it('splits a long sentence at commas and keeps every piece under the limit', () => {
    const sentence =
      Array.from({ length: 12 }, (_, i) => `clause number ${i} goes here`).join(', ') + '.';
    const pieces = chunkForSpeech(sentence, 60);
    expect(pieces.every((p) => p.length <= 60)).toBe(true);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(sentence);
  });

  it('splits a long run with no punctuation at word boundaries', () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const pieces = chunkForSpeech(text, 50);
    expect(pieces.every((p) => p.length <= 50)).toBe(true);
    expect(pieces.join(' ')).toBe(text);
  });

  it('returns nothing for empty text and collapses whitespace', () => {
    expect(chunkForSpeech('   ')).toEqual([]);
    expect(chunkForSpeech('a   b\n c')).toEqual(['a b c']);
  });
});

describe('estimateSpeechMs', () => {
  it('grows with length and shrinks as the rate rises', () => {
    expect(estimateSpeechMs('a b c d e f g h i j', 1)).toBeGreaterThan(estimateSpeechMs('a b', 1));
    expect(estimateSpeechMs('a b c d e f g h i j', 1.3)).toBeLessThan(
      estimateSpeechMs('a b c d e f g h i j', 0.7),
    );
  });
});

describe('rms', () => {
  it('is zero for nothing and for silence', () => {
    expect(rms([])).toBe(0);
    expect(rms([0, 0, 0])).toBe(0);
  });

  it('measures level', () => {
    expect(rms([1, -1, 1, -1])).toBe(1);
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5);
  });
});

describe('SilenceDetector', () => {
  const opts = { threshold: 0.05, silenceMs: 2000, noSpeechMs: 10_000 };
  const LOUD = 0.2;
  const QUIET = 0.001;

  it('reports when speech starts, once', () => {
    const d = new SilenceDetector(opts, 0);
    expect(d.feed(LOUD, 100)).toBe('speech-started');
    expect(d.feed(LOUD, 200)).toBeNull();
  });

  it('ends after the silence window once the student has spoken', () => {
    const d = new SilenceDetector(opts, 0);
    d.feed(LOUD, 500);
    expect(d.feed(QUIET, 1500)).toBeNull();
    expect(d.feed(QUIET, 2400)).toBeNull();
    expect(d.feed(QUIET, 2500)).toBe('silence');
    expect(d.feed(QUIET, 9000)).toBeNull(); // reported once
  });

  it('restarts the silence clock every time the student speaks again', () => {
    const d = new SilenceDetector(opts, 0);
    d.feed(LOUD, 100);
    d.feed(QUIET, 1900);
    d.feed(LOUD, 2000); // a pause within the verse
    expect(d.feed(QUIET, 3500)).toBeNull();
    expect(d.feed(QUIET, 4000)).toBe('silence');
  });

  it('never ends on silence before the first word', () => {
    const d = new SilenceDetector(opts, 0);
    expect(d.feed(QUIET, 5000)).toBeNull();
    expect(d.feed(QUIET, 9000)).toBeNull();
  });

  it('gives up when speech never starts', () => {
    const d = new SilenceDetector(opts, 1000);
    expect(d.feed(QUIET, 10_999)).toBeNull();
    expect(d.feed(QUIET, 11_000)).toBe('no-speech');
    expect(d.feed(LOUD, 12_000)).toBeNull();
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_SILENCE.noSpeechMs).toBeGreaterThan(DEFAULT_SILENCE.silenceMs);
  });
});
