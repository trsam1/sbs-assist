import { describe, it, expect } from 'vitest';
import { StudyWorksheet } from '../models';
import {
  DEFAULT_SORT,
  groupByWord,
  languageOf,
  matchesLanguage,
  nextSort,
  plainRows,
  sortStudies,
} from './study-list-sort';

function study(
  id: string,
  word: string,
  strongs: string,
  updatedAt = '2026-01-01',
  ids: string[] = [],
): StudyWorksheet {
  return {
    id,
    userId: 'u',
    createdAt: '',
    updatedAt,
    bookStudyIds: ids,
    wordStudies: [{ word, strongsNumber: strongs }],
  } as unknown as StudyWorksheet;
}

const ids = (list: readonly StudyWorksheet[]) => list.map((s) => s.id);

describe('languageOf', () => {
  it('reads G as Greek and H as Hebrew, any case', () => {
    expect(languageOf('G25')).toBe('greek');
    expect(languageOf('g5368')).toBe('greek');
    expect(languageOf('H157')).toBe('hebrew');
    expect(languageOf(' h1 ')).toBe('hebrew');
  });

  it('is none for a missing or unrecognized number', () => {
    expect(languageOf('')).toBe('none');
    expect(languageOf(undefined)).toBe('none');
    expect(languageOf('25')).toBe('none');
    expect(languageOf('X9')).toBe('none');
  });
});

describe('sortStudies', () => {
  const a = study('a', 'Love', 'G25', '2026-03-01');
  const b = study('b', 'faith', 'G4102', '2026-01-01');
  const c = study('c', 'mercy', 'H2617', '2026-02-01');
  const d = study('d', 'grace', '', '2026-04-01');

  it('sorts by word, ignoring case', () => {
    expect(ids(sortStudies([a, b, c, d], { key: 'word', dir: 'asc' }))).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
    expect(ids(sortStudies([a, b, c, d], { key: 'word', dir: 'desc' }))).toEqual([
      'c',
      'a',
      'd',
      'b',
    ]);
  });

  it("sorts Strong's numbers by letter then number, with no number last", () => {
    expect(ids(sortStudies([b, a, c, d], { key: 'strongs', dir: 'asc' }))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('puts G25 before G5368 and G before H (not as text)', () => {
    const x = study('x', 'x', 'G5368');
    const y = study('y', 'y', 'G25');
    const z = study('z', 'z', 'H3');
    expect(ids(sortStudies([z, x, y], { key: 'strongs', dir: 'asc' }))).toEqual(['y', 'x', 'z']);
  });

  it('sorts by language', () => {
    const out = sortStudies([c, a, b], { key: 'language', dir: 'asc' });
    expect(ids(out)).toEqual(['a', 'b', 'c']); // Greek ones first (in arrival order), then Hebrew
  });

  it('sorts by date, newest first by default', () => {
    expect(ids(sortStudies([b, a, c, d], DEFAULT_SORT))).toEqual(['d', 'a', 'c', 'b']);
  });

  it('sorts by book names, studies with no book last', () => {
    const withBook = study('e', 'e', 'G1', '2026-01-01', ['bk']);
    const names = (s: StudyWorksheet) => (s.bookStudyIds.includes('bk') ? 'Romans' : '');
    expect(ids(sortStudies([a, withBook], { key: 'books', dir: 'asc' }, names))).toEqual([
      'e',
      'a',
    ]);
  });

  it('keeps studies that compare equal in the order they arrived', () => {
    const p = study('p', 'love', 'G5368', '2026-01-01');
    const q = study('q', 'love', 'G25', '2026-01-01');
    expect(ids(sortStudies([p, q], { key: 'updated', dir: 'desc' }))).toEqual(['p', 'q']);
    expect(ids(sortStudies([q, p], { key: 'updated', dir: 'desc' }))).toEqual(['q', 'p']);
    expect(ids(sortStudies([p, q], { key: 'word', dir: 'desc' }))).toEqual(['p', 'q']);
  });

  it('puts studies with no book last when ascending and first when descending', () => {
    const withBook = study('e', 'e', 'G1', '2026-01-01', ['bk']);
    const names = (s: StudyWorksheet) => (s.bookStudyIds.includes('bk') ? 'Romans' : '');
    expect(ids(sortStudies([a, withBook], { key: 'books', dir: 'asc' }, names))).toEqual([
      'e',
      'a',
    ]);
    expect(ids(sortStudies([a, withBook], { key: 'books', dir: 'desc' }, names))).toEqual([
      'a',
      'e',
    ]);
  });

  it('never changes the input', () => {
    const input = [b, a];
    sortStudies(input, { key: 'word', dir: 'asc' });
    expect(ids(input)).toEqual(['b', 'a']);
  });
});

describe('nextSort', () => {
  it('flips the direction of the column already sorted', () => {
    expect(nextSort({ key: 'word', dir: 'asc' }, 'word')).toEqual({ key: 'word', dir: 'desc' });
    expect(nextSort({ key: 'word', dir: 'desc' }, 'word')).toEqual({ key: 'word', dir: 'asc' });
  });

  it('starts a new column ascending, and the date newest first', () => {
    expect(nextSort(DEFAULT_SORT, 'word')).toEqual({ key: 'word', dir: 'asc' });
    expect(nextSort({ key: 'word', dir: 'asc' }, 'updated')).toEqual({
      key: 'updated',
      dir: 'desc',
    });
  });
});

describe('groupByWord', () => {
  it('puts studies of the same English word together, ignoring case, with a heading', () => {
    const rows = groupByWord([
      study('1', 'love', 'G25'),
      study('2', 'faith', 'G4102'),
      study('3', 'Love', 'G5368'),
      study('4', 'love', 'H157'),
    ]);
    expect(
      rows.map((r) => (r.kind === 'group' ? `group:${r.word}:${r.count}` : r.study.id)),
    ).toEqual(['group:love:3', '1', '3', '4', '2']);
  });

  it('lists the roots in the heading', () => {
    const rows = groupByWord([study('1', 'love', 'G25'), study('2', 'love', 'H157')]);
    expect(rows[0]).toMatchObject({ kind: 'group', strongs: ['G25', 'H157'] });
  });

  it('gives a word with one study no heading', () => {
    const rows = groupByWord([study('1', 'faith', 'G4102'), study('2', 'hope', 'G1680')]);
    expect(rows.every((r) => r.kind === 'study')).toBe(true);
  });

  it('keeps the order words first appear, so it respects the chosen sort', () => {
    const rows = groupByWord([study('1', 'b', 'G1'), study('2', 'a', 'G2'), study('3', 'b', 'G3')]);
    expect(rows.map((r) => (r.kind === 'group' ? 'g' : r.study.id))).toEqual(['g', '1', '3', '2']);
  });

  it('is empty for no studies', () => {
    expect(groupByWord([])).toEqual([]);
    expect(plainRows([])).toEqual([]);
  });
});

describe('matchesLanguage', () => {
  it('filters by language, and all passes everything', () => {
    const g = study('g', 'a', 'G1');
    const h = study('h', 'b', 'H1');
    const n = study('n', 'c', '');
    expect([g, h, n].filter((s) => matchesLanguage(s, 'all'))).toHaveLength(3);
    expect(ids([g, h, n].filter((s) => matchesLanguage(s, 'greek')))).toEqual(['g']);
    expect(ids([g, h, n].filter((s) => matchesLanguage(s, 'hebrew')))).toEqual(['h']);
    expect(ids([g, h, n].filter((s) => matchesLanguage(s, 'none')))).toEqual(['n']);
  });
});
