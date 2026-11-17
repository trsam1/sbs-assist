import { describe, it, expect } from 'vitest';
import { BookStudy } from './models';
import { bookNames, linkedBooks, matchesBookFilter } from './study-books';

function book(id: string, name: string): BookStudy {
  return {
    id,
    book: name,
    title: '',
    notes: '',
    createdAt: '',
    updatedAt: '',
    referents: [],
    userId: 'u',
  } as BookStudy;
}

const BOOKS = [book('b1', 'Romans'), book('b2', 'Ephesians'), book('b3', 'Jude')];

describe('study-books', () => {
  it('lists linked books in book order and skips deleted ones', () => {
    expect(linkedBooks(['b3', 'gone', 'b1'], BOOKS).map((b) => b.id)).toEqual(['b1', 'b3']);
  });

  it('joins book names, or shows a dash when nothing matches', () => {
    expect(bookNames(['b1', 'b2'], BOOKS)).toBe('Romans, Ephesians');
    expect(bookNames([], BOOKS)).toBe('—');
    expect(bookNames(['gone'], BOOKS)).toBe('—');
  });

  it('filters: all shows everything', () => {
    expect(matchesBookFilter([], BOOKS, 'all')).toBe(true);
    expect(matchesBookFilter(['b1'], BOOKS, 'all')).toBe(true);
  });

  it('filters: a study linked to several books matches each of them', () => {
    expect(matchesBookFilter(['b1', 'b2'], BOOKS, 'b1')).toBe(true);
    expect(matchesBookFilter(['b1', 'b2'], BOOKS, 'b2')).toBe(true);
    expect(matchesBookFilter(['b1', 'b2'], BOOKS, 'b3')).toBe(false);
  });

  it('filters: none matches studies with no loaded book, including ones linked only to a deleted book', () => {
    expect(matchesBookFilter([], BOOKS, 'none')).toBe(true);
    expect(matchesBookFilter(['gone'], BOOKS, 'none')).toBe(true);
    expect(matchesBookFilter(['b1'], BOOKS, 'none')).toBe(false);
  });
});
