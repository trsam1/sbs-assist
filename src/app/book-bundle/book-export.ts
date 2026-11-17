import { FigureEntry, OutlineStudy, StudyWorksheet, WordStudyEntry } from '../models';
import { nameForType } from '../figures-taxonomy';
import { INTERROGATION_CATEGORIES } from '../interrogation-questions';
import { deriveState, readSchedule, toLocalIsoDate } from '../memorize-view/srs';
import { outlineLabels } from '../outline-number';
import { stepById, stepLabel } from '../steps';
import { BookBundle, failedParts } from './book-bundle';

export interface ExportOptions {
  /** Include the whole scroll text (large). Default off. */
  includeScroll: boolean;
  /** Include the word studies linked to the book. Default on. */
  includeWordStudies: boolean;
  /** Injected for tests; the export date. */
  now: Date;
}

export const DEFAULT_EXPORT_OPTIONS: Omit<ExportOptions, 'now'> = {
  includeScroll: false,
  includeWordStudies: true,
};

// --- escaping -------------------------------------------------------------------------------------

/**
 * Escape the student's text so Markdown structure in the document is only the exporter's own: inline
 * punctuation is escaped, and a line that would start a heading, list item or quote is defused.
 */
export function escapeMd(text: string): string {
  return text
    .replace(/([\\`*_[\]<>|])/g, '\\$1')
    .split('\n')
    .map((line) =>
      line
        // "1. text" would become a list item: escape the dot, not the digit.
        .replace(/^(\s*\d+)([.)])(\s)/, '$1\\$2$3')
        .replace(/^(\s*)(#|[-+](?=\s)|=+\s*$)/, '$1\\$2'),
    )
    .join('\n');
}

/** A single table cell: escaped, with line breaks as <br> so the row stays on one line. */
function cell(text: string): string {
  return escapeMd(text).replace(/\s*\n\s*/g, '<br>') || ' ';
}

/** A paragraph of student text: escaped, with a hard break at each newline. */
function para(text: string): string {
  return escapeMd(text.trim()).replace(/\n/g, '  \n');
}

/** A fence long enough that the text inside it can never close it. */
function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}\n${text}\n${ticks}`;
}

const heading = (level: number, text: string): string => `${'#'.repeat(level)} ${text}`;
const stepHeading = (id: string): string => {
  const step = stepById(id);
  return step ? stepLabel(step) : id;
};

// --- file name ------------------------------------------------------------------------------------

/** e.g. `romans-study-2026-11-17.md` */
export function fileName(bookName: string, ext: 'md' | 'json', now: Date): string {
  const slug =
    bookName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'book';
  return `${slug}-study-${toLocalIsoDate(now)}.${ext}`;
}

// --- Markdown -------------------------------------------------------------------------------------

function wordStudyMd(w: WordStudyEntry): string[] {
  const out: string[] = [
    heading(3, escapeMd(w.strongsNumber ? `${w.word} (${w.strongsNumber})` : w.word)),
  ];
  const defs = w.englishDefinition?.meanings ?? [];
  if (defs.length > 0) {
    out.push('**English definition**');
    for (const m of defs) {
      for (const d of m.definitions) {
        out.push(
          `- ${m.partOfSpeech ? `_${escapeMd(m.partOfSpeech)}_ ` : ''}${escapeMd(d.definition)}`,
        );
      }
    }
  }
  if (w.definitionNotes.trim())
    out.push(`**Your notes on the definition:** ${para(w.definitionNotes)}`);
  if (w.strongsDefinition || w.originalWord) {
    const orig = [w.originalWord, w.transliteration && `(${w.transliteration})`]
      .filter(Boolean)
      .join(' ');
    out.push(
      `**Strong's:** ${escapeMd(orig)}${w.strongsDefinition ? ` — ${escapeMd(w.strongsDefinition)}` : ''}`,
    );
  }
  if (w.strongsNotes.trim()) out.push(`**Your notes on Strong's:** ${para(w.strongsNotes)}`);
  if (w.lexiconEntry.trim()) out.push(`**Lexicon:** ${para(w.lexiconEntry)}`);
  if (w.lexiconNotes.trim()) out.push(`**Your notes on the lexicon:** ${para(w.lexiconNotes)}`);
  if (w.crossReferences.length > 0) {
    out.push('**Cross-references**');
    for (const c of w.crossReferences) {
      out.push(
        `- ${escapeMd(c.reference)}${c.notes.trim() ? ` — ${escapeMd(c.notes.trim())}` : ''}`,
      );
    }
  }
  if (w.notes.trim()) out.push(`**Notes:** ${para(w.notes)}`);
  if (w.aiSummary.trim())
    out.push(`**AI summary (generated, not your words):** ${para(w.aiSummary)}`);
  return out.flatMap((line, i) => (i === 0 ? [line] : ['', line]));
}

function outlineMd(o: OutlineStudy): string[] {
  const out: string[] = [];
  for (const label of outlineLabels(o.paragraphs, o.groupings)) {
    const indent = '  '.repeat(label.level);
    if (label.kind === 'grouping') {
      const g = o.groupings[label.ref];
      out.push(`${indent}- **${label.label}.** ${escapeMd(g.title)}`);
      if (g.notes.trim()) out.push(`${indent}  _${escapeMd(g.notes.trim()).replace(/\n/g, ' ')}_`);
    } else {
      const p = o.paragraphs[label.ref];
      const range = [p.startRef, p.endRef].filter(Boolean).join('–');
      out.push(
        `${indent}- **${label.label}.** ${escapeMd(p.mainIdea)}${range ? ` (${escapeMd(range)})` : ''}`,
      );
      if (p.notes.trim()) out.push(`${indent}  _${escapeMd(p.notes.trim()).replace(/\n/g, ' ')}_`);
    }
  }
  return out;
}

function figureLine(f: FigureEntry): string {
  const type = f.figureType === 'other' ? f.otherLabel || 'Other' : nameForType(f.figureType);
  const bits = [`**${escapeMd(f.reference)}** — ${escapeMd(type)}`];
  if (f.text.trim()) bits.push(`Text: ${escapeMd(f.text.trim()).replace(/\n/g, ' ')}`);
  if (f.interpretation.trim())
    bits.push(`Interpretation: ${escapeMd(f.interpretation.trim()).replace(/\n/g, ' ')}`);
  if (f.notes.trim()) bits.push(`Notes: ${escapeMd(f.notes.trim()).replace(/\n/g, ' ')}`);
  return `- ${bits.join('. ')}`;
}

/** The whole book as a readable Markdown document. Pure: same bundle and options, same text. */
export function toMarkdown(bundle: BookBundle, options: ExportOptions): string {
  const { book } = bundle;
  const out: string[] = [];
  const add = (...lines: string[]): void => {
    out.push(...lines, '');
  };

  add(heading(1, escapeMd(book.title.trim() ? `${book.book} — ${book.title.trim()}` : book.book)));
  add(`Exported ${toLocalIsoDate(options.now)}`);

  const missing = failedParts(bundle);
  if (missing.length > 0) {
    add(
      `> **Not included** (could not be loaded): ${missing.join(', ')}. This is a partial export.`,
    );
  }

  const startLength = out.length;

  if (book.notes.trim()) add(heading(2, 'Notes'), para(book.notes));

  const scroll = bundle.scroll.data;
  if (options.includeScroll && scroll && scroll.scrollText.trim()) {
    add(heading(2, stepHeading('scroll')), fence(scroll.scrollText));
  }

  const words = bundle.wordStudies.data ?? [];
  if (options.includeWordStudies && words.length > 0) {
    add(heading(2, stepHeading('word-study')));
    const entries = words.flatMap((s: StudyWorksheet) => s.wordStudies);
    for (const w of entries) add(...wordStudyMd(w));
  }

  const ante = bundle.antecedents.data;
  const rows = (ante?.assignments ?? []).filter((a) => a.antecedent.trim() || a.pronounType);
  if (rows.length > 0 || book.referents.length > 0) {
    add(heading(2, 'Step 6 — Antecedents and Referents'));
    if (rows.length > 0) {
      add(heading(3, 'Antecedents'));
      add(
        '| # | Pronoun | Type | Antecedent |',
        '| --- | --- | --- | --- |',
        ...rows.map(
          (a) =>
            `| ${a.occurrence + 1} | ${cell(a.word)} | ${cell(a.pronounType ?? '')} | ${cell(a.antecedent)} |`,
        ),
      );
    }
    if (book.referents.length > 0) {
      add(heading(3, 'Referents'));
      for (const r of book.referents) {
        const extra = [r.notes.trim(), r.scrollRef.trim() && `Location: ${r.scrollRef.trim()}`]
          .filter(Boolean)
          .join(' ');
        add(
          `- **${escapeMd(r.phrase)}** → ${escapeMd(r.refersTo)}${extra ? ` — ${escapeMd(extra).replace(/\n/g, ' ')}` : ''}`,
        );
      }
    }
  }

  const st = bundle.structure.data;
  if (st && bundle.structure.status === 'loaded') {
    add(heading(2, stepHeading('structure')));
    if (st.genre) add(`**Genre:** ${escapeMd(st.genre)}`);
    if (st.tone) add(`**Tone:** ${escapeMd(st.tone)}`);
    if ((st.secondaryGenres ?? []).length > 0) {
      add(heading(3, 'Other genres in the book'));
      add(
        ...st.secondaryGenres.map((g) => {
          const range = [g.startRef, g.endRef].filter(Boolean).join('–');
          return `- ${escapeMd(g.genre)}${range ? ` (${escapeMd(range)})` : ''}${g.notes.trim() ? ` — ${escapeMd(g.notes.trim()).replace(/\n/g, ' ')}` : ''}`;
        }),
      );
    }
    if (st.sections.length > 0) {
      add(heading(3, 'Sections'));
      add(
        ...st.sections.map((s, i) => {
          const range = [s.startRef, s.endRef].filter(Boolean).join('–');
          return `${i + 1}. ${escapeMd(s.label)}${range ? ` (${escapeMd(range)})` : ''}${s.notes.trim() ? ` — ${escapeMd(s.notes.trim()).replace(/\n/g, ' ')}` : ''}`;
        }),
      );
    }
    if (st.markers.length > 0) {
      add(heading(3, 'Markers'));
      add(
        ...st.markers.map(
          (m) =>
            `- _${m.kind}_ — ${escapeMd(m.phrase)}${m.ref ? ` (${escapeMd(m.ref)})` : ''}${m.notes.trim() ? ` — ${escapeMd(m.notes.trim()).replace(/\n/g, ' ')}` : ''}`,
        ),
      );
    }
    if (st.elements.length > 0) {
      add(heading(3, 'Elements'));
      add(
        ...st.elements.map(
          (e) =>
            `- ${escapeMd(e.element)}${e.sectionRefs.length ? ` — ${e.sectionRefs.map(escapeMd).join(', ')}` : ''}`,
        ),
      );
    }
  }

  const ol = bundle.outline.data;
  if (ol && ol.paragraphs.length + ol.groupings.length > 0) {
    add(heading(2, stepHeading('outline')), ...outlineMd(ol));
  }
  if (ol && (ol.theme.trim() || ol.purpose.trim())) {
    add(heading(2, stepHeading('theme')));
    if (ol.theme.trim()) add(`**Theme:** ${para(ol.theme)}`);
    if (ol.purpose.trim()) add(`**Purpose:** ${para(ol.purpose)}`);
  }

  const fig = bundle.figures.data;
  if (fig && fig.entries.length > 0) {
    add(heading(2, stepHeading('figures')));
    for (const [group, title] of [
      ['parallelism', 'Parallelism'],
      ['figure', 'Figures of speech'],
    ] as const) {
      const list = fig.entries.filter((e) => e.group === group);
      if (list.length > 0) add(heading(3, title), ...list.map(figureLine));
    }
  }

  const q = bundle.interrogation.data;
  if (q && q.entries.length > 0) {
    add(heading(2, stepHeading('interrogate')));
    for (const cat of INTERROGATION_CATEGORIES) {
      const list = q.entries.filter((e) => e.category === cat);
      if (list.length === 0) continue;
      add(heading(3, cat.charAt(0).toUpperCase() + cat.slice(1)));
      for (const e of list) {
        const meta = [
          e.passageRef && escapeMd(e.passageRef),
          e.tags.length && e.tags.map(escapeMd).join(', '),
        ]
          .filter(Boolean)
          .join(' · ');
        add(`- **${escapeMd(e.question)}**${meta ? ` (${meta})` : ''}`);
        if (e.answer.trim()) add(`  ${para(e.answer).replace(/\n/g, '\n  ')}`);
        if (e.notes.trim()) add(`  _Notes: ${escapeMd(e.notes.trim()).replace(/\n/g, ' ')}_`);
      }
    }
  }

  const mem = bundle.memorization.data;
  if (mem && mem.chunks.length > 0) {
    add(heading(2, stepHeading('memorize')));
    add(
      '| Reference | Progress | Next review |',
      '| --- | --- | --- |',
      ...mem.chunks.map((c) => {
        const due = readSchedule(c).dueDate;
        return `| ${cell(c.verseRef || '(unlabeled)')} | ${deriveState(c)} | ${due || 'due now'} |`;
      }),
    );
  }

  if (out.length === startLength) add('_No work recorded for this book yet._');

  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}

// --- JSON backup ----------------------------------------------------------------------------------

const IDENTITY_KEYS = new Set(['userId', 'PK', 'SK', 'GSI1PK', 'GSI1SK']);

/** Remove identity and storage-key fields from every object, recursively. Never mutates the input. */
export function stripIdentity<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripIdentity(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!IDENTITY_KEYS.has(k)) out[k] = stripIdentity(v);
    }
    return out as T;
  }
  return value;
}

export interface BookExportJson {
  format: 'axios-book-export';
  version: 1;
  exportedAt: string;
  /** Labels of parts that could not be loaded; empty for a complete export. */
  unavailable: string[];
  book: unknown;
  scroll?: unknown;
  wordStudies?: unknown;
  antecedents?: unknown;
  structure?: unknown;
  outline?: unknown;
  figures?: unknown;
  interrogation?: unknown;
  memorization?: unknown;
}

/** The JSON backup: each source exactly as the app stores it, minus identity, plus a version. */
export function toJson(bundle: BookBundle, options: ExportOptions): string {
  const payload: BookExportJson = {
    format: 'axios-book-export',
    version: 1,
    exportedAt: options.now.toISOString(),
    unavailable: failedParts(bundle),
    book: stripIdentity(bundle.book),
  };
  const scroll = bundle.scroll.data;
  if (scroll) {
    const { scrollText, ...meta } = scroll;
    payload.scroll = stripIdentity(options.includeScroll ? { ...meta, scrollText } : meta);
  }
  if (options.includeWordStudies && bundle.wordStudies.data) {
    payload.wordStudies = stripIdentity(bundle.wordStudies.data);
  }
  if (bundle.antecedents.data) payload.antecedents = stripIdentity(bundle.antecedents.data);
  if (bundle.structure.data) payload.structure = stripIdentity(bundle.structure.data);
  if (bundle.outline.data) payload.outline = stripIdentity(bundle.outline.data);
  if (bundle.figures.data) payload.figures = stripIdentity(bundle.figures.data);
  if (bundle.interrogation.data) payload.interrogation = stripIdentity(bundle.interrogation.data);
  if (bundle.memorization.data) payload.memorization = stripIdentity(bundle.memorization.data);
  return JSON.stringify(payload, null, 2) + '\n';
}
