import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BIBLE_BOOKS, NEW_TESTAMENT_BOOKS, OLD_TESTAMENT_BOOKS, isValidBook } from './bible-books';

/**
 * The frontend keeps its own copy of this list at src/app/bible-books.ts. The two bundles
 * are separate, so to catch drift without a cross-package import we assert the backend copy
 * deep-equals this literal 66-name array (the same list the frontend ships).
 */
const EXPECTED_BIBLE_BOOKS: readonly string[] = [
  // Old Testament (39)
  'Genesis',
  'Exodus',
  'Leviticus',
  'Numbers',
  'Deuteronomy',
  'Joshua',
  'Judges',
  'Ruth',
  '1 Samuel',
  '2 Samuel',
  '1 Kings',
  '2 Kings',
  '1 Chronicles',
  '2 Chronicles',
  'Ezra',
  'Nehemiah',
  'Esther',
  'Job',
  'Psalms',
  'Proverbs',
  'Ecclesiastes',
  'Song of Solomon',
  'Isaiah',
  'Jeremiah',
  'Lamentations',
  'Ezekiel',
  'Daniel',
  'Hosea',
  'Joel',
  'Amos',
  'Obadiah',
  'Jonah',
  'Micah',
  'Nahum',
  'Habakkuk',
  'Zephaniah',
  'Haggai',
  'Zechariah',
  'Malachi',
  // New Testament (27)
  'Matthew',
  'Mark',
  'Luke',
  'John',
  'Acts',
  'Romans',
  '1 Corinthians',
  '2 Corinthians',
  'Galatians',
  'Ephesians',
  'Philippians',
  'Colossians',
  '1 Thessalonians',
  '2 Thessalonians',
  '1 Timothy',
  '2 Timothy',
  'Titus',
  'Philemon',
  'Hebrews',
  'James',
  '1 Peter',
  '2 Peter',
  '1 John',
  '2 John',
  '3 John',
  'Jude',
  'Revelation',
];

describe('bible-books (shared)', () => {
  it('has 66 canonical books split 39 OT / 27 NT', () => {
    expect(OLD_TESTAMENT_BOOKS).toHaveLength(39);
    expect(NEW_TESTAMENT_BOOKS).toHaveLength(27);
    expect(BIBLE_BOOKS).toHaveLength(66);
    expect(BIBLE_BOOKS).toEqual([...OLD_TESTAMENT_BOOKS, ...NEW_TESTAMENT_BOOKS]);
  });

  it('matches the frontend copy exactly (guards against drift)', () => {
    expect(BIBLE_BOOKS).toEqual(EXPECTED_BIBLE_BOOKS);
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
