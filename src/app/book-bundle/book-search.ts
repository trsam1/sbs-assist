import { stepById, stepLink } from '../steps';
import { BookBundle } from './book-bundle';

// --- folding --------------------------------------------------------------------------------------

/**
 * Lower-case and strip accents, keeping a map from each folded character back to its index in the
 * original text, so a match can be highlighted in the text the student actually wrote.
 */
export function fold(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const folded = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    map.push(...new Array<number>(folded.length).fill(i));
    norm += folded;
    i += ch.length;
  }
  map.push(text.length); // so the end of a match at the very end of the text still maps
  return { norm, map };
}

/** The query as folded words; empty when there is nothing to search for. */
export function queryWords(query: string): string[] {
  return fold(query)
    .norm.split(/\s+/)
    .filter((w) => w.length > 0);
}

// --- entries --------------------------------------------------------------------------------------

export type GroupId =
  | 'notes'
  | 'referents'
  | 'words'
  | 'antecedents'
  | 'structure'
  | 'outline'
  | 'figures'
  | 'interrogation'
  | 'memorization'
  | 'scroll';

export const GROUP_ORDER: readonly { id: GroupId; label: string }[] = [
  { id: 'notes', label: 'Book notes' },
  { id: 'referents', label: 'Referents' },
  { id: 'words', label: 'Word studies' },
  { id: 'antecedents', label: 'Antecedents' },
  { id: 'structure', label: 'Structure' },
  { id: 'outline', label: 'Outline and theme' },
  { id: 'figures', label: 'Figures of speech' },
  { id: 'interrogation', label: 'Interrogation' },
  { id: 'memorization', label: 'Memorization' },
  { id: 'scroll', label: 'Scroll text' },
];

export interface SearchEntry {
  group: GroupId;
  /** Where in the group the text came from, e.g. "answer". */
  field: string;
  text: string;
  /** The text folded once, so each search is a substring test. */
  norm: string;
  /** Router commands for the page where this can be edited; null when it is on the page already. */
  link: string[] | null;
}

function entry(
  group: GroupId,
  field: string,
  text: string,
  link: string[] | null,
): SearchEntry | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { group, field, text: trimmed, norm: fold(trimmed).norm, link };
}

function stepRoute(id: string, scrollId: string): string[] | null {
  const step = stepById(id);
  return step && scrollId ? stepLink(step, scrollId) : null;
}

/**
 * Flatten the bundle into one entry per searchable string. Memorization contributes reference labels only:
 * the app stores offsets, not verse text. The scroll is separate (`scrollEntries`) because it is large and
 * optional.
 */
export function buildEntries(bundle: BookBundle): SearchEntry[] {
  const out: (SearchEntry | null)[] = [];
  const { book } = bundle;
  const scrollId = bundle.scroll.data?.id ?? '';

  out.push(entry('notes', 'title', book.title, null), entry('notes', 'notes', book.notes, null));
  for (const r of book.referents) {
    out.push(
      entry('referents', 'phrase', r.phrase, null),
      entry('referents', 'refers to', r.refersTo, null),
      entry('referents', 'notes', r.notes, null),
      entry('referents', 'location', r.scrollRef, null),
    );
  }

  for (const s of bundle.wordStudies.data ?? []) {
    const link = ['/study', s.id];
    for (const w of s.wordStudies) {
      out.push(
        entry('words', 'word', w.word, link),
        entry('words', "Strong's number", w.strongsNumber, link),
        entry('words', 'definition notes', w.definitionNotes, link),
        entry('words', "Strong's notes", w.strongsNotes, link),
        entry('words', 'lexicon notes', w.lexiconNotes, link),
        entry('words', 'notes', w.notes, link),
        entry('words', 'AI summary', w.aiSummary, link),
      );
      for (const c of w.crossReferences) {
        out.push(
          entry('words', 'cross-reference', c.reference, link),
          entry('words', 'cross-reference notes', c.notes, link),
        );
      }
    }
  }

  const ante = stepRoute('antecedents', scrollId);
  for (const a of bundle.antecedents.data?.assignments ?? []) {
    out.push(
      entry('antecedents', `antecedent of "${a.word}"`, a.antecedent, ante),
      entry('antecedents', `type of "${a.word}"`, a.pronounType ?? '', ante),
    );
  }

  const st = bundle.structure.data;
  const stLink = stepRoute('structure', scrollId);
  if (st) {
    out.push(
      entry('structure', 'genre', st.genre, stLink),
      entry('structure', 'tone', st.tone, stLink),
    );
    for (const m of st.markers) {
      out.push(
        entry('structure', 'marker', m.phrase, stLink),
        entry('structure', 'marker location', m.ref, stLink),
        entry('structure', 'marker notes', m.notes, stLink),
      );
    }
    for (const s of st.sections) {
      out.push(
        entry('structure', 'section', s.label, stLink),
        entry('structure', 'section notes', s.notes, stLink),
      );
    }
    for (const e of st.elements) out.push(entry('structure', 'element', e.element, stLink));
    for (const g of st.secondaryGenres ?? []) {
      out.push(
        entry('structure', 'other genre', g.genre, stLink),
        entry('structure', 'other genre notes', g.notes, stLink),
      );
    }
  }

  const ol = bundle.outline.data;
  const olLink = stepRoute('outline', scrollId);
  if (ol) {
    out.push(
      entry('outline', 'theme', ol.theme, olLink),
      entry('outline', 'purpose', ol.purpose, olLink),
    );
    for (const p of ol.paragraphs) {
      out.push(
        entry('outline', 'main idea', p.mainIdea, olLink),
        entry('outline', 'paragraph notes', p.notes, olLink),
      );
    }
    for (const g of ol.groupings) {
      out.push(
        entry('outline', 'section title', g.title, olLink),
        entry('outline', 'section notes', g.notes, olLink),
      );
    }
  }

  const figLink = stepRoute('figures', scrollId);
  for (const f of bundle.figures.data?.entries ?? []) {
    out.push(
      entry('figures', 'reference', f.reference, figLink),
      entry('figures', 'type', f.otherLabel, figLink),
      entry('figures', 'text', f.text, figLink),
      entry('figures', 'interpretation', f.interpretation, figLink),
      entry('figures', 'notes', f.notes, figLink),
    );
  }

  const qLink = stepRoute('interrogate', scrollId);
  for (const q of bundle.interrogation.data?.entries ?? []) {
    out.push(
      entry('interrogation', 'question', q.question, qLink),
      entry('interrogation', 'answer', q.answer, qLink),
      entry('interrogation', 'passage', q.passageRef, qLink),
      entry('interrogation', 'notes', q.notes, qLink),
      entry('interrogation', 'tags', q.tags.join(' '), qLink),
    );
  }

  const memLink = stepRoute('memorize', scrollId);
  for (const c of bundle.memorization.data?.chunks ?? []) {
    out.push(entry('memorization', 'reference', c.verseRef, memLink));
  }

  return out.filter((e): e is SearchEntry => e !== null);
}

/** One entry per non-empty line of the scroll text. Built separately: it is large and optional. */
export function scrollEntries(bundle: BookBundle): SearchEntry[] {
  const scroll = bundle.scroll.data;
  if (!scroll || !scroll.scrollText) return [];
  const link = stepRoute('scroll', scroll.id);
  return scroll.scrollText
    .split('\n')
    .map((line) => entry('scroll', 'line', line, link))
    .filter((e): e is SearchEntry => e !== null);
}

// --- searching ------------------------------------------------------------------------------------

export interface Segment {
  text: string;
  mark: boolean;
}

export interface Hit {
  field: string;
  link: string[] | null;
  segments: Segment[];
  /** True when the snippet starts or ends part-way through the text. */
  cutStart: boolean;
  cutEnd: boolean;
}

export interface ResultGroup {
  id: GroupId;
  label: string;
  /** All matches in the group, including ones not shown. */
  total: number;
  hits: Hit[];
}

export const MAX_PER_GROUP = 25;
const SNIPPET_WIDTH = 80;

function occurrences(norm: string, word: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = norm.indexOf(word, from);
    if (at < 0) return out;
    out.push(at);
    from = at + Math.max(1, word.length);
  }
}

/** A snippet of `text` around the first match, with every match inside it marked. */
export function snippet(
  text: string,
  words: readonly string[],
  width = SNIPPET_WIDTH,
): Omit<Hit, 'field' | 'link'> {
  const { norm, map } = fold(text);
  const firsts = words.map((w) => norm.indexOf(w)).filter((i) => i >= 0);
  const center = firsts.length > 0 ? Math.min(...firsts) : 0;

  const startOrig = Math.max(0, map[center] - width);
  const endOrig = Math.min(text.length, map[Math.min(center, map.length - 1)] + width * 2);

  // Marked ranges (in original indexes) that fall inside the window, merged where they touch.
  const ranges: [number, number][] = [];
  for (const w of words) {
    for (const at of occurrences(norm, w)) {
      const s = map[at];
      const e = map[at + w.length];
      if (e > startOrig && s < endOrig) ranges.push([Math.max(s, startOrig), Math.min(e, endOrig)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const segments: Segment[] = [];
  let cursor = startOrig;
  for (const [s, e] of merged) {
    if (s > cursor) segments.push({ text: text.slice(cursor, s), mark: false });
    segments.push({ text: text.slice(s, e), mark: true });
    cursor = e;
  }
  if (cursor < endOrig) segments.push({ text: text.slice(cursor, endOrig), mark: false });

  return { segments, cutStart: startOrig > 0, cutEnd: endOrig < text.length };
}

/**
 * All entries that contain every word of the query (case and accent insensitive), grouped in the fixed group
 * order and capped per group. An empty query returns no groups.
 */
export function search(entries: readonly SearchEntry[], query: string): ResultGroup[] {
  const words = queryWords(query);
  if (words.length === 0) return [];

  const byGroup = new Map<GroupId, SearchEntry[]>();
  for (const e of entries) {
    if (words.every((w) => e.norm.includes(w))) {
      const list = byGroup.get(e.group) ?? [];
      list.push(e);
      byGroup.set(e.group, list);
    }
  }

  return GROUP_ORDER.filter((g) => byGroup.has(g.id)).map((g) => {
    const matches = byGroup.get(g.id) as SearchEntry[];
    return {
      id: g.id,
      label: g.label,
      total: matches.length,
      hits: matches.slice(0, MAX_PER_GROUP).map((m) => ({
        field: m.field,
        link: m.link,
        ...snippet(m.text, words),
      })),
    };
  });
}

/** Total matches across groups, for the live count. */
export function totalMatches(groups: readonly ResultGroup[]): number {
  return groups.reduce((n, g) => n + g.total, 0);
}
