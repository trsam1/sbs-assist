import { describe, it, expect } from 'vitest';
import { BIBLICAL_GENRES } from './structure-genres';

describe('BIBLICAL_GENRES', () => {
  it('is non-empty and lists the seven biblical genres from the Step 7 reference', () => {
    expect(BIBLICAL_GENRES.length).toBe(7);
    for (const g of [
      'historical narrative',
      'law',
      'poetry',
      'wisdom',
      'prophecy',
      'letter/epistle',
      'apocalyptic',
    ]) {
      expect(BIBLICAL_GENRES).toContain(g);
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(BIBLICAL_GENRES).size).toBe(BIBLICAL_GENRES.length);
  });
});
