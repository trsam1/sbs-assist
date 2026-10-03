import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BIBLE_BOOKS, NEW_TESTAMENT_BOOKS, OLD_TESTAMENT_BOOKS, isValidBook } from './bible-books';

describe('bible-books', () => {
  it('has 66 canonical books split 39 OT / 27 NT', () => {
    expect(OLD_TESTAMENT_BOOKS).toHaveLength(39);
    expect(NEW_TESTAMENT_BOOKS).toHaveLength(27);
    expect(BIBLE_BOOKS).toHaveLength(66);
    expect(BIBLE_BOOKS).toEqual([...OLD_TESTAMENT_BOOKS, ...NEW_TESTAMENT_BOOKS]);
  });

  it('isValidBook is true for every canonical name', () => {
    for (const book of BIBLE_BOOKS) {
      expect(isValidBook(book)).toBe(true);
    }
  });

  it('isValidBook is false for junk values', () => {
    expect(isValidBook('')).toBe(false);
    expect(isValidBook('genesis')).toBe(false);
    expect(isValidBook('Gospel of Thomas')).toBe(false);
    expect(isValidBook('1 Maccabees')).toBe(false);
  });

  describe('property-based', () => {
    it('isValidBook returns true for any member', () => {
      fc.assert(
        fc.property(fc.constantFrom(...BIBLE_BOOKS), (book) => {
          expect(isValidBook(book)).toBe(true);
        }),
      );
    });

    it('isValidBook returns false for any non-member string', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !BIBLE_BOOKS.includes(s)),
          (s) => {
            expect(isValidBook(s)).toBe(false);
          },
        ),
      );
    });
  });
});
