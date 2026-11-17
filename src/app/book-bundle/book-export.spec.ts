import { describe, it, expect } from 'vitest';
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
import { BookBundle, Part, empty, failed } from './book-bundle';
import {
  DEFAULT_EXPORT_OPTIONS,
  ExportOptions,
  escapeMd,
  fileName,
  stripIdentity,
  toJson,
  toMarkdown,
} from './book-export';

const NOW = new Date(2026, 10, 17, 9, 0, 0);
const OPTS: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, now: NOW };

const loaded = <T>(data: T): Part<T> => ({ status: 'loaded', data });

const BOOK: BookStudy = {
  id: 'b1',
  userId: 'cognito-sub-123',
  book: 'Romans',
  title: 'Grace and faith',
  notes: 'Read slowly.\nTwice.',
  createdAt: '',
  updatedAt: '',
  referents: [
    { phrase: 'the righteous one', refersTo: 'Christ', notes: 'see 1:17', scrollRef: '1:17' },
  ],
};

function bundle(over: Partial<BookBundle> = {}): BookBundle {
  return {
    book: BOOK,
    scroll: empty(),
    wordStudies: empty(),
    antecedents: empty(),
    structure: empty(),
    outline: empty(),
    figures: empty(),
    interrogation: empty(),
    memorization: empty(),
    ...over,
  };
}

const SCROLL: ScrollStudy = {
  id: 's1',
  userId: 'cognito-sub-123',
  bookStudyId: 'b1',
  bookName: 'Romans',
  status: 'ready',
  scrollText: 'Paul, a servant of Christ Jesus',
  truncated: false,
  failureReason: '',
  createdAt: '',
  updatedAt: '',
};

const WORD: StudyWorksheet = {
  id: 'w1',
  userId: 'cognito-sub-123',
  createdAt: '',
  updatedAt: '',
  bookStudyIds: ['b1'],
  wordStudies: [
    {
      word: 'grace',
      strongsNumber: 'G5485',
      englishDefinition: {
        word: 'grace',
        meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'unmerited favor' }] }],
      },
      strongsDefinition: 'favor',
      originalWord: 'χάρις',
      transliteration: 'charis',
      lexiconEntry: 'From chairo',
      crossReferences: [{ reference: 'Eph 2:8', notes: 'by grace' }],
      aiSummary: 'A summary.',
      notes: 'My note',
      definitionNotes: 'def note',
      strongsNotes: '',
      lexiconNotes: '',
    },
  ],
};

const ANTE: AntecedentStudy = {
  scrollStudyId: 's1',
  userId: 'u',
  createdAt: '',
  updatedAt: '',
  assignments: [
    { occurrence: 0, start: 0, word: 'he', antecedent: 'Paul', pronounType: 'personal' },
    { occurrence: 1, start: 5, word: 'it', antecedent: '' },
  ],
};

const STRUCT: StructureStudy = {
  scrollStudyId: 's1',
  userId: 'u',
  genre: 'Epistle',
  tone: 'Urgent',
  markers: [{ kind: 'transition', phrase: 'therefore', ref: '12:1', notes: '' }],
  sections: [{ label: 'Gospel', startRef: '1:1', endRef: '8:39', notes: '' }],
  elements: [{ element: 'faith', sectionRefs: ['Gospel'] }],
  secondaryGenres: [{ genre: 'Hymn', startRef: '11:33', endRef: '11:36', notes: '' }],
  createdAt: '',
  updatedAt: '',
};

const OUTLINE: OutlineStudy = {
  scrollStudyId: 's1',
  userId: 'u',
  paragraphs: [
    { startRef: '1:1', endRef: '1:7', mainIdea: 'Greeting', notes: '' },
    { startRef: '1:8', endRef: '1:15', mainIdea: 'Thanksgiving', notes: 'warm' },
  ],
  groupings: [{ column: 1, startIndex: 0, endIndex: 1, title: 'Introduction', notes: '' }],
  theme: 'Righteousness by faith',
  purpose: 'To prepare the way to Rome.',
  createdAt: '',
  updatedAt: '',
};

const FIGS: FiguresStudy = {
  scrollStudyId: 's1',
  userId: 'u',
  createdAt: '',
  updatedAt: '',
  entries: [
    {
      figureType: 'other',
      otherLabel: 'Wordplay',
      group: 'figure',
      reference: '1:1',
      text: '',
      interpretation: 'It means X',
      notes: '',
    },
  ],
};

const INTERR: InterrogationStudy = {
  scrollStudyId: 's1',
  userId: 'u',
  createdAt: '',
  updatedAt: '',
  entries: [
    {
      question: 'Who wrote it?',
      category: 'who',
      tags: ['author'],
      passageRef: '1:1',
      answer: 'Paul',
      notes: '',
    },
  ],
};

const MEM: MemorizationStudy = {
  scrollStudyId: 's1',
  userId: 'u',
  createdAt: '',
  updatedAt: '',
  chunks: [
    { start: 0, end: 5, verseRef: '1:1-5', state: 'new' },
    {
      start: 6,
      end: 9,
      verseRef: '1:6-9',
      state: 'new',
      dueDate: '2026-11-20',
      lastReviewed: '2026-11-17',
      intervalDays: 3,
    },
  ],
};

const FULL = bundle({
  scroll: loaded(SCROLL),
  wordStudies: loaded([WORD]),
  antecedents: loaded(ANTE),
  structure: loaded(STRUCT),
  outline: loaded(OUTLINE),
  figures: loaded(FIGS),
  interrogation: loaded(INTERR),
  memorization: loaded(MEM),
});

describe('toMarkdown', () => {
  const md = toMarkdown(FULL, OPTS);

  it('heads the document with the book, title and date', () => {
    expect(md.startsWith('# Romans — Grace and faith\n')).toBe(true);
    expect(md).toContain('Exported 2026-11-17');
  });

  it('writes the steps in method order', () => {
    const order = [
      '## Notes',
      '## Step 5 — Define Key Words',
      '## Step 6 — Antecedents and Referents',
      '## Step 7 — Structure of the Book',
      '## Step 8 — Provisional Outline',
      '## Step 9 — Theme and Purpose',
      '## Step 10 — Figures of Speech',
      '## Step 12 — Interrogate the Text',
      '## Memorize the Scroll',
    ].map((h) => md.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('numbers the outline in I / A form', () => {
    expect(md).toContain('- **I.** Introduction');
    expect(md).toContain('  - **A.** Greeting (1:1–1:7)');
    expect(md).toContain('  - **B.** Thanksgiving (1:8–1:15)');
  });

  it('labels AI summaries so they are never mistaken for the student', () => {
    expect(md).toContain('**AI summary (generated, not your words):** A summary.');
  });

  it('lists word study details', () => {
    expect(md).toContain('### grace (G5485)');
    expect(md).toContain('unmerited favor');
    expect(md).toContain('Eph 2:8');
  });

  it('only lists antecedents that have something filled in', () => {
    expect(md).toContain('| 1 | he | personal | Paul |');
    expect(md).not.toContain('| 2 | it |');
  });

  it('exports memorization as labels, progress and due dates, never text', () => {
    expect(md).toContain('| 1:1-5 | new | due now |');
    expect(md).toContain('| 1:6-9 | learning | 2026-11-20 |');
    expect(md).not.toContain('Paul, a servant');
  });

  it('leaves the scroll text out by default and includes it, fenced, when asked', () => {
    expect(md).not.toContain('Paul, a servant of Christ Jesus');
    const withScroll = toMarkdown(FULL, { ...OPTS, includeScroll: true });
    expect(withScroll).toContain('## Step 4 — Observe the Text as a Scroll');
    expect(withScroll).toContain('```\nPaul, a servant of Christ Jesus\n```');
  });

  it('leaves word studies out when switched off', () => {
    const noWords = toMarkdown(FULL, { ...OPTS, includeWordStudies: false });
    expect(noWords).not.toContain('Define Key Words');
  });

  it('groups interrogation by category', () => {
    expect(md).toContain('### Who');
    expect(md).toContain('- **Who wrote it?** (1:1 · author)');
  });

  it('skips steps with nothing saved', () => {
    const only = toMarkdown(bundle({ figures: loaded(FIGS) }), OPTS);
    expect(only).toContain('Step 10');
    expect(only).not.toContain('Step 7');
    expect(only).not.toContain('Memorize');
  });

  it('says so when there is nothing at all', () => {
    const none = toMarkdown(bundle({ book: { ...BOOK, notes: '', referents: [] } }), OPTS);
    expect(none).toContain('No work recorded for this book yet.');
  });

  it('names failed parts at the top so a partial export is never mistaken for a full one', () => {
    const partial = toMarkdown(bundle({ figures: failed(), memorization: failed() }), OPTS);
    expect(partial).toContain(
      '**Not included** (could not be loaded): Figures of speech, Memorization.',
    );
    expect(partial.indexOf('Not included')).toBeLessThan(partial.indexOf('## Notes'));
  });

  it('is deterministic', () => {
    expect(toMarkdown(FULL, OPTS)).toBe(toMarkdown(FULL, OPTS));
  });
});

describe('escapeMd', () => {
  it('escapes inline markdown characters', () => {
    expect(escapeMd('a *b* _c_ `d` [e] <f> | g')).toBe(
      'a \\*b\\* \\_c\\_ \\`d\\` \\[e\\] \\<f\\> \\| g',
    );
  });

  it('defuses lines that would become headings, lists or numbered lists', () => {
    expect(escapeMd('# title')).toBe('\\# title');
    expect(escapeMd('- item')).toBe('\\- item');
    expect(escapeMd('1. first')).toBe('1\\. first');
    expect(escapeMd('ok\n## sub')).toBe('ok\n\\## sub');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeMd('Paul wrote to Rome, in 57 AD.')).toBe('Paul wrote to Rome, in 57 AD.');
  });

  it('cannot break out of the document through a note', () => {
    const evil = toMarkdown(
      bundle({ book: { ...BOOK, notes: '# Injected\n- x', referents: [] } }),
      OPTS,
    );
    expect(evil).not.toMatch(/^# Injected/m);
    expect(evil).toContain('\\# Injected');
  });

  it('lengthens the fence so scroll text containing backticks cannot close it', () => {
    const tricky = bundle({ scroll: loaded({ ...SCROLL, scrollText: 'a ``` b' }) });
    const md = toMarkdown(tricky, { ...OPTS, includeScroll: true });
    expect(md).toContain('````\na ``` b\n````');
  });
});

describe('toJson', () => {
  const parsed = JSON.parse(toJson(FULL, OPTS));

  it('has the format, version and export time', () => {
    expect(parsed.format).toBe('axios-book-export');
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe(NOW.toISOString());
    expect(parsed.unavailable).toEqual([]);
  });

  it('never contains user ids', () => {
    expect(JSON.stringify(parsed)).not.toContain('cognito-sub-123');
    expect(JSON.stringify(parsed)).not.toContain('userId');
  });

  it('carries each source as the app stores it', () => {
    expect(parsed.book.book).toBe('Romans');
    expect(parsed.outline.paragraphs).toHaveLength(2);
    expect(parsed.wordStudies[0].wordStudies[0].word).toBe('grace');
    expect(parsed.memorization.chunks).toHaveLength(2);
  });

  it('omits the scroll text unless asked', () => {
    expect(parsed.scroll.scrollText).toBeUndefined();
    const withText = JSON.parse(toJson(FULL, { ...OPTS, includeScroll: true }));
    expect(withText.scroll.scrollText).toBe('Paul, a servant of Christ Jesus');
  });

  it('lists failed parts in unavailable and leaves their keys out', () => {
    const p = JSON.parse(toJson(bundle({ outline: failed() }), OPTS));
    expect(p.unavailable).toEqual(['Outline and theme']);
    expect('outline' in p).toBe(false);
  });
});

describe('stripIdentity', () => {
  it('removes identity and storage keys at every depth without mutating the input', () => {
    const input = { userId: 'u', a: [{ PK: 'x', keep: 1, nested: { GSI1PK: 'y', ok: true } }] };
    const out = stripIdentity(input);
    expect(out).toEqual({ a: [{ keep: 1, nested: { ok: true } }] });
    expect(input.userId).toBe('u');
  });
});

describe('fileName', () => {
  it('slugs the book name and adds the date', () => {
    expect(fileName('Romans', 'md', NOW)).toBe('romans-study-2026-11-17.md');
    expect(fileName('1 John', 'json', NOW)).toBe('1-john-study-2026-11-17.json');
    expect(fileName('Song of Solomon', 'md', NOW)).toBe('song-of-solomon-study-2026-11-17.md');
  });

  it('never returns an empty slug', () => {
    expect(fileName('???', 'md', NOW)).toBe('book-study-2026-11-17.md');
  });
});
