import { describe, it, expect } from 'vitest';
import { RecitationGradeResult } from '../models';
import {
  CoachStep,
  DEFAULT_COACH_PREFS,
  normalizePrefs,
  pauseMs,
  planLearnVerse,
  planTestPrompt,
  resultSpeech,
  splitPhrases,
} from './coach-plan';

const P = DEFAULT_COACH_PREFS;
const spoken = (steps: CoachStep[]) =>
  steps.filter((s) => s.kind === 'speak').map((s) => (s as { text: string }).text);

describe('splitPhrases', () => {
  it('breaks after punctuation', () => {
    expect(
      splitPhrases('For God so loved the world, that he gave his only Son, that whoever believes'),
    ).toEqual([
      'For God so loved the world,',
      'that he gave his only Son,',
      'that whoever believes',
    ]);
  });

  it('does not speak a leading verse number', () => {
    expect(splitPhrases('16 For God so loved the world.')).toEqual(['For God so loved the world.']);
    expect(splitPhrases('3. In the beginning was the Word')).toEqual([
      'In the beginning was the Word',
    ]);
  });

  it('splits a long clause near its middle', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve';
    const out = splitPhrases(long, 8);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((p) => p.split(' ').length <= 8)).toBe(true);
    expect(out.join(' ')).toBe(long);
  });

  it('splits purely by word count when there is no punctuation', () => {
    const text = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    const out = splitPhrases(text, 6);
    expect(out.every((p) => p.split(' ').length <= 6)).toBe(true);
    expect(out.join(' ')).toBe(text);
  });

  it('folds pieces of fewer than three words into a neighbor', () => {
    expect(splitPhrases('Then Jesus wept. So it was, and he said.')).toEqual([
      'Then Jesus wept.',
      'So it was,',
      'and he said.',
    ]);
    expect(splitPhrases('Go, now is the time to act.')).toEqual(['Go, now is the time to act.']);
    const out = splitPhrases('Go. Now is the time to act, my friend.');
    expect(out.every((p) => p.split(' ').length >= 3)).toBe(true);
  });

  it('keeps all the words, in order, for quoted speech and odd spacing', () => {
    const text = '“Come,   follow me,”  Jesus said;  “and I will make you fishers of men.”';
    expect(splitPhrases(text).join(' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('returns nothing for empty input', () => {
    expect(splitPhrases('')).toEqual([]);
    expect(splitPhrases('   ')).toEqual([]);
  });

  it('returns a short verse as one phrase', () => {
    expect(splitPhrases('Jesus wept.')).toEqual(['Jesus wept.']);
  });
});

describe('pauseMs', () => {
  it('scales with the word count but never goes below the floor', () => {
    expect(pauseMs('one two', 700, 2500)).toBe(2500);
    expect(pauseMs('a b c d e f g h i j', 700, 2500)).toBe(7000);
  });
});

describe('planLearnVerse', () => {
  const verse =
    'For God so loved the world, that he gave his only Son, that whoever believes in him.';

  it('hears the whole verse first', () => {
    const steps = planLearnVerse(verse, null, P);
    expect(steps[0]).toMatchObject({ kind: 'speak', text: verse });
  });

  it('teaches phrase by phrase, each followed by a wait to repeat', () => {
    const steps = planLearnVerse(verse, null, P);
    const idx = steps.findIndex(
      (s) => s.kind === 'speak' && s.text === 'For God so loved the world,',
    );
    expect(idx).toBeGreaterThan(0);
    expect(steps[idx + 1]).toMatchObject({ kind: 'wait' });
  });

  it('chains phrases 1..k together after each new phrase', () => {
    const texts = spoken(planLearnVerse(verse, null, P));
    expect(texts).toContain('For God so loved the world, that he gave his only Son,');
    expect(texts).toContain(
      'For God so loved the world, that he gave his only Son, that whoever believes in him.',
    );
  });

  it('ends the verse with the whole thing from memory, then the text to check against', () => {
    const steps = planLearnVerse(verse, null, P);
    const last = steps[steps.length - 1];
    expect(last).toMatchObject({ kind: 'speak', text: verse, label: 'Check yourself' });
    expect(steps[steps.length - 2].kind).toBe('wait');
  });

  it('adds a cumulative pass over earlier verses', () => {
    const steps = planLearnVerse('Jesus wept.', 'In the beginning was the Word.', P, 2);
    const texts = spoken(steps);
    expect(texts).toContain('Now verses one through 2, from memory.');
    expect(texts[texts.length - 1]).toBe('In the beginning was the Word. Jesus wept.');
  });

  it('skips the cumulative pass for the first verse', () => {
    expect(spoken(planLearnVerse(verse, null, P)).join(' ')).not.toContain('through');
    expect(spoken(planLearnVerse(verse, '   ', P)).join(' ')).not.toContain('through');
  });

  it('scales every wait with the phrase length', () => {
    const steps = planLearnVerse(verse, null, P);
    const waits = steps.filter((s) => s.kind === 'wait') as { ms: number }[];
    expect(waits.every((w) => w.ms >= P.floorMs)).toBe(true);
    expect(Math.max(...waits.map((w) => w.ms))).toBeGreaterThan(P.floorMs);
  });

  it('plans nothing for an empty verse and never includes a grade or record step', () => {
    expect(planLearnVerse('', null, P)).toEqual([]);
    expect(planLearnVerse(verse, 'x', P).some((s) => s.kind === 'record')).toBe(false);
  });

  it('gives every step a label for the screen', () => {
    expect(planLearnVerse(verse, 'x y z', P).every((s) => s.label.length > 0)).toBe(true);
  });
});

describe('planTestPrompt', () => {
  it('says the reference and "your turn", marks the moment, then listens', () => {
    const steps = planTestPrompt('John 3:16', P);
    expect(steps.map((s) => s.kind)).toEqual(['speak', 'tone', 'record']);
    expect((steps[0] as { text: string }).text).toBe('John 3:16. Your turn.');
  });

  it('leaves the tone out when tones are off, and copes with no reference', () => {
    const steps = planTestPrompt('', { ...P, tones: false });
    expect(steps.map((s) => s.kind)).toEqual(['speak', 'record']);
    expect((steps[0] as { text: string }).text).toBe('Your turn.');
  });
});

describe('resultSpeech', () => {
  const graded = (
    over: Partial<RecitationGradeResult>,
  ): { kind: 'graded'; result: RecitationGradeResult } => ({
    kind: 'graded',
    result: {
      grade: 'good',
      reason: '',
      accuracyPct: 91.4,
      missedWords: [],
      transcript: 'x',
      ...over,
    },
  });

  it('speaks the grade and accuracy', () => {
    expect(resultSpeech(graded({}), false)).toBe('Good. 91 percent.');
  });

  it('names up to three missed words and counts the rest', () => {
    expect(resultSpeech(graded({ grade: 'hard', missedWords: ['grace', 'faith'] }), false)).toBe(
      'Hard. 91 percent. You missed: grace, faith.',
    );
    expect(resultSpeech(graded({ missedWords: ['a', 'b', 'c', 'd', 'e'] }), false)).toContain(
      'You missed: a, b, c, and 2 more.',
    );
  });

  it('says to try again when the card will repeat', () => {
    expect(resultSpeech(graded({ grade: 'again' }), true)).toContain('Needs work.');
    expect(resultSpeech(graded({ grade: 'again' }), true)).toContain('Try again.');
  });

  it('does not claim missed words when the grade was degraded', () => {
    const text = resultSpeech(graded({ degraded: true, missedWords: ['x'] }), false);
    expect(text).toContain('scored by word match');
    expect(text).not.toContain('You missed');
  });

  it('covers silence, failure and no microphone', () => {
    expect(resultSpeech({ kind: 'silent' }, false)).toContain("didn't hear");
    expect(resultSpeech({ kind: 'failed' }, false)).toContain('Moving on');
    expect(resultSpeech({ kind: 'unavailable' }, false)).toContain('microphone');
  });
});

describe('normalizePrefs', () => {
  it('returns the defaults for anything that is not an object', () => {
    expect(normalizePrefs(null)).toEqual(P);
    expect(normalizePrefs('x')).toEqual(P);
    expect(normalizePrefs(undefined)).toEqual(P);
  });

  it('clamps numbers into range and ignores wrong types', () => {
    const p = normalizePrefs({
      rate: 9,
      perWordMs: 'fast',
      silenceMs: 1,
      tones: 'yes',
      maxPhraseWords: 2.6,
    });
    expect(p.rate).toBe(1.3);
    expect(p.perWordMs).toBe(P.perWordMs);
    expect(p.silenceMs).toBe(1200);
    expect(p.tones).toBe(P.tones);
    expect(p.maxPhraseWords).toBe(3);
  });

  it('keeps valid values', () => {
    const p = normalizePrefs({ rate: 0.8, tones: false, voiceName: 'Samantha' });
    expect(p).toMatchObject({ rate: 0.8, tones: false, voiceName: 'Samantha' });
  });
});
