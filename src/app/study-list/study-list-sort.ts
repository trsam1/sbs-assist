import { StudyWorksheet } from '../models';

/** Greek (New Testament, `G…`), Hebrew (Old Testament, `H…`), or none (no Strong's number yet). */
export type Language = 'greek' | 'hebrew' | 'none';
export type LanguageFilter = 'all' | Language;

export type SortKey = 'word' | 'strongs' | 'language' | 'books' | 'updated';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** The order the list arrives in: most recently updated first. */
export const DEFAULT_SORT: SortState = { key: 'updated', dir: 'desc' };

/** What a Strong's number says about the original language: `H` is Hebrew, `G` is Greek. */
export function languageOf(strongsNumber: string | undefined): Language {
  const c = (strongsNumber ?? '').trim().charAt(0).toUpperCase();
  if (c === 'G') return 'greek';
  if (c === 'H') return 'hebrew';
  return 'none';
}

export const LANGUAGE_LABELS: Record<Language, string> = {
  greek: 'Greek',
  hebrew: 'Hebrew',
  none: '—',
};

/** A study's headline word and Strong's number (the first entry; a study holds one word today). */
export function headWord(study: StudyWorksheet): string {
  return study.wordStudies[0]?.word ?? '';
}

export function headStrongs(study: StudyWorksheet): string {
  return study.wordStudies[0]?.strongsNumber ?? '';
}

/** Sort key for a Strong's number: letter, then the number, so G25 comes before G5368 and G before H. */
function strongsSortKey(n: string): [string, number] {
  const m = /^\s*([A-Za-z])\s*(\d+)/.exec(n);
  return m ? [m[1].toUpperCase(), Number(m[2])] : ['~', 0]; // no number sorts last
}

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

function compareBy(key: SortKey, booksOf: (s: StudyWorksheet) => string) {
  return (a: StudyWorksheet, b: StudyWorksheet): number => {
    switch (key) {
      case 'word':
        return compareText(headWord(a), headWord(b));
      case 'strongs': {
        const [la, na] = strongsSortKey(headStrongs(a));
        const [lb, nb] = strongsSortKey(headStrongs(b));
        return la === lb ? na - nb : la < lb ? -1 : 1;
      }
      case 'language':
        return compareText(languageOf(headStrongs(a)), languageOf(headStrongs(b)));
      case 'books': {
        // Studies with no book sort after the ones that have one (whichever way the column runs).
        const ba = booksOf(a);
        const bb = booksOf(b);
        if (!ba && !bb) return 0;
        if (!ba) return 1;
        if (!bb) return -1;
        return compareText(ba, bb);
      }
      case 'updated':
        return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
    }
  };
}

/**
 * A sorted copy. Studies that compare equal keep the order they arrived in (the list arrives newest first),
 * because the sort is stable. Never mutates the input.
 */
export function sortStudies(
  studies: readonly StudyWorksheet[],
  sort: SortState,
  booksOf: (s: StudyWorksheet) => string = () => '',
): StudyWorksheet[] {
  const compare = compareBy(sort.key, booksOf);
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...studies].sort((a, b) => sign * compare(a, b));
}

/** One line of the table: a study, or the heading above a group of studies that share an English word. */
export type ListRow =
  | { kind: 'group'; word: string; count: number; strongs: string[] }
  | { kind: 'study'; study: StudyWorksheet };

const wordKey = (study: StudyWorksheet): string => headWord(study).trim().toLowerCase();

/**
 * Put studies of the same English word together (case-insensitive), in the order the words first appear,
 * with a heading above any word that has two or more studies. This is how different Greek or Hebrew roots
 * translated by the same English word sit side by side. A word with one study gets no heading.
 */
export function groupByWord(studies: readonly StudyWorksheet[]): ListRow[] {
  const order: string[] = [];
  const groups = new Map<string, StudyWorksheet[]>();
  for (const s of studies) {
    const key = wordKey(s);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)?.push(s);
  }
  const rows: ListRow[] = [];
  for (const key of order) {
    const members = groups.get(key) as StudyWorksheet[];
    if (members.length > 1) {
      rows.push({
        kind: 'group',
        word: headWord(members[0]),
        count: members.length,
        strongs: members.map(headStrongs).filter((n) => n.length > 0),
      });
    }
    for (const study of members) rows.push({ kind: 'study', study });
  }
  return rows;
}

/** Flat rows when not grouping. */
export const plainRows = (studies: readonly StudyWorksheet[]): ListRow[] =>
  studies.map((study) => ({ kind: 'study', study }));

/** Whether a study passes the language filter. */
export function matchesLanguage(study: StudyWorksheet, filter: LanguageFilter): boolean {
  return filter === 'all' || languageOf(headStrongs(study)) === filter;
}

/** The next sort when a column header is pressed: the same column flips direction, a new one starts ascending
 * (the date column starts newest first). */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'updated' ? 'desc' : 'asc' };
}
