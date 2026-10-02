import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getTestament, validateStrongsNumber } from './validation';

describe('getTestament', () => {
  it("returns OT for Hebrew Strong's numbers", () => {
    expect(getTestament('H157')).toBe('OT');
    expect(getTestament('H1')).toBe('OT');
    expect(getTestament('H9999')).toBe('OT');
  });

  it("returns NT for Greek Strong's numbers", () => {
    expect(getTestament('G25')).toBe('NT');
    expect(getTestament('G1')).toBe('NT');
    expect(getTestament('G5624')).toBe('NT');
  });

  /**
   * **Validates: Requirements 1.2**
   * Property: For any Strong's number starting with 'H', getTestament returns 'OT';
   * for any starting with 'G', it returns 'NT'.
   */
  it('returns OT for any valid H-prefixed number and NT for any valid G-prefixed number', () => {
    const positiveInt = fc.integer({ min: 1, max: 99999 });

    fc.assert(
      fc.property(positiveInt, (num) => {
        expect(getTestament(`H${num}`)).toBe('OT');
        expect(getTestament(`G${num}`)).toBe('NT');
      }),
    );
  });
});
