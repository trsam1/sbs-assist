import { BookStudy } from './models';

/** 'all' shows everything, 'none' shows studies linked to no loaded book, otherwise a book id. */
export type BookFilter = 'all' | 'none' | string;

/** The linked books that still exist, in the order the books were loaded. */
export function linkedBooks(
  ids: readonly string[],
  books: readonly BookStudy[],
): readonly BookStudy[] {
  const chosen = new Set(ids);
  return books.filter((b) => chosen.has(b.id));
}

/** "Romans, Ephesians", or an en dash when the study is linked to no loaded book. */
export function bookNames(ids: readonly string[], books: readonly BookStudy[]): string {
  const names = linkedBooks(ids, books).map((b) => b.book);
  return names.length > 0 ? names.join(', ') : '—';
}

/**
 * Whether a study with these links passes the filter. A deleted book's id matches no loaded book, so a
 * study linked only to it counts as "no book".
 */
export function matchesBookFilter(
  ids: readonly string[],
  books: readonly BookStudy[],
  filter: BookFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return linkedBooks(ids, books).length === 0;
  return ids.includes(filter);
}
