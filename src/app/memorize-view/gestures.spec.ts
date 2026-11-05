import { describe, it, expect } from 'vitest';
import {
  classifySwipe,
  swipeToGrade,
  keyToGrade,
  isFlipKey,
  DEFAULT_SWIPE_OPTIONS,
} from './gestures';

describe('gestures.classifySwipe', () => {
  it('classifies a clear vertical-up swipe', () => {
    expect(classifySwipe(0, -80)).toBe('up');
  });

  it('classifies a clear vertical-down swipe', () => {
    expect(classifySwipe(5, 90)).toBe('down');
  });

  it('classifies clear horizontal swipes by sign', () => {
    expect(classifySwipe(-70, 5)).toBe('left');
    expect(classifySwipe(70, -5)).toBe('right');
  });

  it('returns none for a move below the min distance', () => {
    expect(classifySwipe(0, -20)).toBe('none'); // 20 < 40 min
    expect(classifySwipe(20, 0)).toBe('none');
  });

  it('returns none for a diagonal-ambiguous move (no dominant axis)', () => {
    // 60 vs 60 — neither axis clears the 1.5x dominance ratio
    expect(classifySwipe(60, -60)).toBe('none');
  });

  it('honors a custom min distance and dominance ratio', () => {
    const opts = { minDistance: 10, dominanceRatio: 1.2 };
    expect(classifySwipe(0, -12, opts)).toBe('up');
    expect(classifySwipe(0, -8, opts)).toBe('none');
  });

  it('exposes sensible defaults', () => {
    expect(DEFAULT_SWIPE_OPTIONS.minDistance).toBeGreaterThan(0);
    expect(DEFAULT_SWIPE_OPTIONS.dominanceRatio).toBeGreaterThan(1);
  });
});

describe('gestures.swipeToGrade', () => {
  it('maps left to again (hardest) and right to easy (easiest)', () => {
    expect(swipeToGrade('left')).toBe('again');
    expect(swipeToGrade('right')).toBe('easy');
  });

  it('maps up/down/none to no grade (up is flip, handled elsewhere)', () => {
    expect(swipeToGrade('up')).toBeNull();
    expect(swipeToGrade('down')).toBeNull();
    expect(swipeToGrade('none')).toBeNull();
  });
});

describe('gestures.keyToGrade', () => {
  it('maps 1-4 to again/hard/good/easy', () => {
    expect(keyToGrade('1')).toBe('again');
    expect(keyToGrade('2')).toBe('hard');
    expect(keyToGrade('3')).toBe('good');
    expect(keyToGrade('4')).toBe('easy');
  });

  it('maps any other key to null', () => {
    expect(keyToGrade('5')).toBeNull();
    expect(keyToGrade('a')).toBeNull();
    expect(keyToGrade('Enter')).toBeNull();
  });
});

describe('gestures.isFlipKey', () => {
  it('recognizes Space, Enter, and ArrowRight', () => {
    expect(isFlipKey(' ')).toBe(true);
    expect(isFlipKey('Spacebar')).toBe(true);
    expect(isFlipKey('Enter')).toBe(true);
    expect(isFlipKey('ArrowRight')).toBe(true);
  });

  it('rejects other keys', () => {
    expect(isFlipKey('1')).toBe(false);
    expect(isFlipKey('ArrowLeft')).toBe(false);
    expect(isFlipKey('a')).toBe(false);
  });
});
