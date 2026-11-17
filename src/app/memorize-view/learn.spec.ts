import { describe, it, expect } from 'vitest';
import {
  initialLearn,
  splitVerses,
  rangeText,
  clampLearn,
  markLearned,
  unmarkLearned,
  unlockNext,
  isReadyToGrade,
  markDone,
  nextChunkToLearn,
} from './learn';

const SCROLL =
  '1:1 In the beginning. 2 And the earth was formless. 3 Let there be light. 2:1 Next chapter.';
const chunk = (start: number, end: number, verseRef = '1:1-3') => ({ start, end, verseRef });

describe('splitVerses', () => {
  it('splits a chunk on verse markers, removes the number, and labels chapter-qualified', () => {
    const end = SCROLL.indexOf(' 2:1');
    const v = splitVerses(SCROLL, chunk(0, end));
    expect(v).toEqual([
      { label: '1:1', text: 'In the beginning.' },
      { label: '1:2', text: 'And the earth was formless.' },
      { label: '1:3', text: 'Let there be light.' },
    ]);
  });

  it('carries the chapter into a later chunk', () => {
    const start = SCROLL.indexOf('2 And');
    const end = SCROLL.indexOf(' 2:1');
    const v = splitVerses(SCROLL, chunk(start, end, '1:2-3'));
    expect(v.map((x) => x.label)).toEqual(['1:2', '1:3']);
  });

  it('folds preamble before the first marker into the first verse', () => {
    const text = 'Psalm of David. 1 The Lord is my shepherd. 2 He makes me lie down.';
    const v = splitVerses(text, chunk(0, text.length, '1-2'));
    expect(v[0].text).toBe('Psalm of David. The Lord is my shepherd.');
    expect(v).toHaveLength(2);
  });

  it('splits a marker-less chunk into sentences', () => {
    const text = 'First idea here. Second idea follows! Third one?';
    const v = splitVerses(text, chunk(0, text.length, 'P1'));
    expect(v.map((x) => x.label)).toEqual(['Part 1', 'Part 2', 'Part 3']);
    expect(v[1].text).toBe('Second idea follows!');
  });

  it('returns a single verse labelled with the chunk ref when there is one unit', () => {
    const v = splitVerses('Just one sentence', chunk(0, 17, 'Intro'));
    expect(v).toEqual([{ label: 'Intro', text: 'Just one sentence' }]);
  });

  it('labels a single unit "Passage" when the chunk has no ref', () => {
    expect(splitVerses('Just one sentence', chunk(0, 17, ''))[0].label).toBe('Passage');
  });

  it('returns no verses for an empty range and clamps stale offsets', () => {
    expect(splitVerses(SCROLL, chunk(5, 5))).toEqual([]);
    expect(splitVerses('abc def', chunk(0, 9999, 'x')).length).toBe(1);
  });
});

describe('rangeText', () => {
  const v = [
    { label: 'a', text: 'One.' },
    { label: 'b', text: 'Two.' },
    { label: 'c', text: 'Three.' },
  ];
  it('joins the first N verses in order', () => {
    expect(rangeText(v, 1)).toBe('One.');
    expect(rangeText(v, 2)).toBe('One. Two.');
    expect(rangeText(v, 3)).toBe('One. Two. Three.');
  });
  it('clamps N to the available range', () => {
    expect(rangeText(v, 99)).toBe('One. Two. Three.');
    expect(rangeText(v, 0)).toBe('');
    expect(rangeText(v, -2)).toBe('');
  });
});

describe('progress transitions', () => {
  it('starts with one verse unlocked and nothing learned', () => {
    expect(initialLearn()).toEqual({ unlocked: 1, learned: 0, done: false });
  });

  it('markLearned counts the newest unlocked verse', () => {
    expect(markLearned({ unlocked: 3, learned: 1, done: false }).learned).toBe(3);
  });

  it('unmarkLearned drops the newest verse back to unlearned and clears done', () => {
    expect(unmarkLearned({ unlocked: 3, learned: 3, done: true })).toEqual({
      unlocked: 3,
      learned: 2,
      done: false,
    });
  });

  it('unlockNext is explicit, allowed without marking learned, and capped at the verse count', () => {
    const p = { unlocked: 1, learned: 0, done: false };
    expect(unlockNext(p, 5).unlocked).toBe(2);
    expect(unlockNext({ ...p, unlocked: 5 }, 5).unlocked).toBe(5);
  });

  it('isReadyToGrade needs every verse unlocked and learned', () => {
    expect(isReadyToGrade({ unlocked: 5, learned: 5, done: false }, 5)).toBe(true);
    expect(isReadyToGrade({ unlocked: 5, learned: 4, done: false }, 5)).toBe(false);
    expect(isReadyToGrade({ unlocked: 4, learned: 4, done: false }, 5)).toBe(false);
    expect(isReadyToGrade(initialLearn(), 0)).toBe(false);
  });

  it('markDone sets the flag', () => {
    expect(markDone(initialLearn()).done).toBe(true);
  });
});

describe('clampLearn', () => {
  it('returns fresh progress when none is stored', () => {
    expect(clampLearn(undefined, 5)).toEqual(initialLearn());
  });
  it('bounds stored counts to a shrunken verse count', () => {
    expect(clampLearn({ unlocked: 5, learned: 5, done: true }, 3)).toEqual({
      unlocked: 3,
      learned: 3,
      done: true,
    });
  });
  it('clears done when the chunk grew past what was learned', () => {
    expect(clampLearn({ unlocked: 3, learned: 3, done: true }, 5).done).toBe(false);
  });
});

describe('nextChunkToLearn', () => {
  const states = ['solid', 'new', 'new'] as const;
  it('prefers an in-progress chunk', () => {
    const chunks = [{}, {}, { learn: { unlocked: 2, learned: 1, done: false } }];
    expect(nextChunkToLearn(chunks, states)).toBe(2);
  });
  it('otherwise takes the first new or learning chunk', () => {
    expect(nextChunkToLearn([{}, {}, {}], states)).toBe(1);
  });
  it('skips chunks whose Learn run is done', () => {
    const chunks = [{}, { learn: { unlocked: 5, learned: 5, done: true } }, {}];
    expect(nextChunkToLearn(chunks, states)).toBe(2);
  });
  it('returns -1 when nothing is left to learn', () => {
    expect(nextChunkToLearn([{}], ['solid'])).toBe(-1);
  });
});
