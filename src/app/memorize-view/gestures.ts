/**
 * Pure input-gesture helpers for the Memorize the Scroll flashcard Review mode.
 * No Angular, no DOM — just math over deltas and a key→action map — so every function is
 * deterministic and unit-tested in isolation, exactly like `srs.ts` and `chunking.ts`.
 *
 * The component wires raw pointer/touch deltas and keydown events to these classifiers, then maps
 * the result to flip()/gradeCard(). Keeping the thresholds and the dominant-axis logic here makes
 * the edge-cases (short moves, diagonal-ambiguous swipes) testable without a browser.
 */

import type { Grade } from './srs';

/** A classified swipe direction, or 'none' when the move is too small or too ambiguous. */
export type SwipeDirection = 'up' | 'down' | 'left' | 'right' | 'none';

/** Tunables for swipe classification (defaults chosen for a phone screen). */
export interface SwipeOptions {
  /** Minimum travel on the dominant axis, in px, to count as a swipe. */
  minDistance: number;
  /** The dominant axis must exceed the other by at least this ratio (avoids diagonal mis-fires). */
  dominanceRatio: number;
}

export const DEFAULT_SWIPE_OPTIONS: SwipeOptions = {
  minDistance: 40,
  dominanceRatio: 1.5,
};

/**
 * Classify a pointer/touch move from its total delta (dx right-positive, dy down-positive).
 * Returns 'none' unless one axis clearly dominates AND clears the min-distance threshold.
 */
export function classifySwipe(
  dx: number,
  dy: number,
  opts: SwipeOptions = DEFAULT_SWIPE_OPTIONS,
): SwipeDirection {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const { minDistance, dominanceRatio } = opts;

  if (ay >= ax * dominanceRatio) {
    // vertical-dominant
    if (ay < minDistance) return 'none';
    return dy < 0 ? 'up' : 'down';
  }
  if (ax >= ay * dominanceRatio) {
    // horizontal-dominant
    if (ax < minDistance) return 'none';
    return dx < 0 ? 'left' : 'right';
  }
  return 'none'; // too diagonal to call
}

/**
 * The action a flipped-card swipe maps to: left = the hardest recall (again), right = the easiest.
 * Up is reserved for flip (handled by the caller); down/none map to no grade.
 */
export function swipeToGrade(dir: SwipeDirection): Grade | null {
  switch (dir) {
    case 'left':
      return 'again';
    case 'right':
      return 'easy';
    default:
      return null;
  }
}

/**
 * Map a keyboard key (from a KeyboardEvent's `key`) to a grade, once the card is flipped.
 * 1/2/3/4 → again/hard/good/easy. Any other key → null.
 */
export function keyToGrade(key: string): Grade | null {
  switch (key) {
    case '1':
      return 'again';
    case '2':
      return 'hard';
    case '3':
      return 'good';
    case '4':
      return 'easy';
    default:
      return null;
  }
}

/** True when the key should flip the card (front↔back): Space, Enter, or ArrowRight. */
export function isFlipKey(key: string): boolean {
  return key === ' ' || key === 'Spacebar' || key === 'Enter' || key === 'ArrowRight';
}
