import {
  AntecedentStudy,
  BookStudy,
  FiguresStudy,
  InterrogationStudy,
  MemorizationStudy,
  OutlineStudy,
  StructureStudy,
  StudyWorksheet,
} from '../models';
import { ScrollStudy } from '../scroll-study.service';

/** loaded = has content, empty = nothing saved yet (normal), failed = could not be read. */
export type PartStatus = 'loaded' | 'empty' | 'failed';

export interface Part<T> {
  status: PartStatus;
  data: T | null;
}

/** Everything the app stores for one book, with a status per part so a partial load is visible. */
export interface BookBundle {
  book: BookStudy;
  scroll: Part<ScrollStudy>;
  wordStudies: Part<StudyWorksheet[]>;
  antecedents: Part<AntecedentStudy>;
  structure: Part<StructureStudy>;
  outline: Part<OutlineStudy>;
  figures: Part<FiguresStudy>;
  interrogation: Part<InterrogationStudy>;
  memorization: Part<MemorizationStudy>;
}

/** Human names for the parts, used in "not included" notes. */
export const PART_LABELS: Record<Exclude<keyof BookBundle, 'book'>, string> = {
  scroll: 'Scroll',
  wordStudies: 'Word studies',
  antecedents: 'Antecedents',
  structure: 'Structure',
  outline: 'Outline and theme',
  figures: 'Figures of speech',
  interrogation: 'Interrogation',
  memorization: 'Memorization',
};

export const empty = <T>(): Part<T> => ({ status: 'empty', data: null });
export const failed = <T>(): Part<T> => ({ status: 'failed', data: null });

/** The labels of every part that failed to load, in a stable order. */
export function failedParts(bundle: BookBundle): string[] {
  return (Object.keys(PART_LABELS) as (keyof typeof PART_LABELS)[])
    .filter((k) => bundle[k].status === 'failed')
    .map((k) => PART_LABELS[k]);
}

// --- "has anything been saved here" tests, one per part ---

export const hasAntecedents = (s: AntecedentStudy): boolean => s.assignments.length > 0;

export const hasStructure = (s: StructureStudy): boolean =>
  !!(s.genre || s.tone) ||
  s.markers.length > 0 ||
  s.sections.length > 0 ||
  s.elements.length > 0 ||
  (s.secondaryGenres?.length ?? 0) > 0;

export const hasOutline = (s: OutlineStudy): boolean =>
  s.paragraphs.length > 0 || s.groupings.length > 0 || !!s.theme || !!s.purpose;

export const hasEntries = (s: { entries: unknown[] }): boolean => s.entries.length > 0;

export const hasChunks = (s: MemorizationStudy): boolean => s.chunks.length > 0;
