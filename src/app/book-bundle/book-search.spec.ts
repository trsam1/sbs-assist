import { describe, it, expect } from 'vitest';
import { BookStudy, MemorizationStudy, StudyWorksheet } from '../models';
import { BookBundle, Part, empty } from './book-bundle';
import {
  MAX_PER_GROUP,
  buildEntries,
  fold,
  queryWords,
  scrollEntries,
  search,
  snippet,
  totalMatches,
} from './book-search';

const loaded = <T>(data: T): Part<T> => ({ status: 'loaded', data });

const BOOK = {
  id: 'b1',
  userId: 'u',
  book: 'Romans',
  title: 'Grace',
  notes: 'Remember the Spirit throughout',
  createdAt: '',
  updatedAt: '',
  referents: [
    { phrase: 'the one who calls', refersTo: 'God the Father', notes: '', scrollRef: '8:30' },
  ],
} as BookStudy;

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

const SCROLL = {
  id: 's1',
  status: 'ready',
  scrollText: 'Paul, a servant of Christ Jesus\n\nthe Spirit of life in Christ\nno condemnation',
} as never;

const WORD = {
  id: 'w1',
  bookStudyIds: ['b1'],
  wordStudies: [
    {
      word: 'spirit',
      strongsNumber: 'G4151',
      notes: 'Breath and wind, also Holy Spirit',
      definitionNotes: '',
      strongsNotes: '',
      lexiconNotes: '',
      aiSummary: '',
      crossReferences: [{ reference: 'John 3:8', notes: 'wind blows' }],
    },
  ],
} as unknown as StudyWorksheet;

const INTERR = {
  entries: [
    {
      question: 'Who is the Spirit?',
      category: 'who',
      tags: ['spirit'],
      passageRef: '8:9',
      answer: 'The Spirit of God',
      notes: '',
    },
  ],
} as never;

const FULL = bundle({
  scroll: loaded(SCROLL),
  wordStudies: loaded([WORD]),
  interrogation: loaded(INTERR),
  memorization: loaded({
    chunks: [{ start: 0, end: 5, verseRef: '8:1-4', state: 'new' }],
  } as unknown as MemorizationStudy),
});

describe('fold', () => {
  it('lower-cases and strips accents, mapping back to the original text', () => {
    const { norm, map } = fold('Élan Vital');
    expect(norm).toBe('elan vital');
    expect(map[0]).toBe(0);
    expect(map[norm.length]).toBe('Élan Vital'.length);
  });

  it('treats Greek accents the same way', () => {
    expect(fold('Πνεῦμα').norm).toBe(fold('πνευμα').norm);
  });
});

describe('queryWords', () => {
  it('splits and folds, and is empty for a blank query', () => {
    expect(queryWords('  Holy   SPIRIT ')).toEqual(['holy', 'spirit']);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('search', () => {
  const entries = [...buildEntries(FULL), ...scrollEntries(FULL)];

  it('returns nothing for an empty query', () => {
    expect(search(entries, '')).toEqual([]);
  });

  it('matches case-insensitively across groups, in the fixed group order', () => {
    const groups = search(entries, 'SPIRIT');
    expect(groups.map((g) => g.id)).toEqual(['notes', 'words', 'interrogation', 'scroll']);
  });

  it('requires every word', () => {
    const groups = search(entries, 'spirit wind');
    expect(groups.map((g) => g.id)).toEqual(['words']);
    expect(search(entries, 'spirit zzz')).toEqual([]);
  });

  it('is accent-insensitive', () => {
    const greek = bundle({ book: { ...BOOK, notes: 'Πνεῦμα means spirit' } });
    expect(search(buildEntries(greek), 'πνευμα')[0].id).toBe('notes');
  });

  it('links each hit to the page where it can be edited', () => {
    const groups = search(entries, 'spirit');
    const words = groups.find((g) => g.id === 'words')!;
    expect(words.hits[0].link).toEqual(['/study', 'w1']);
    const q = groups.find((g) => g.id === 'interrogation')!;
    expect(q.hits[0].link).toEqual(['/scroll', 's1', 'interrogate']);
    const scroll = groups.find((g) => g.id === 'scroll')!;
    expect(scroll.hits[0].link).toEqual(['/scroll', 's1']);
    expect(groups.find((g) => g.id === 'notes')!.hits[0].link).toBeNull();
  });

  it('names the field a hit came from', () => {
    const q = search(entries, 'who is')[0];
    expect(q.hits[0].field).toBe('question');
  });

  it('searches memorization reference labels only', () => {
    expect(search(entries, '8:1-4')[0].id).toBe('memorization');
    expect(search(entries, 'servant')[0].id).toBe('scroll');
  });

  it('skips the scroll when it is not part of the entries', () => {
    const noScroll = search(buildEntries(FULL), 'condemnation');
    expect(noScroll).toEqual([]);
  });

  it('caps each group and still reports the total', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i} grace`).join('\n');
    const big = bundle({
      scroll: loaded({ id: 's1', status: 'ready', scrollText: lines } as never),
    });
    const [g] = search(scrollEntries(big), 'grace');
    expect(g.total).toBe(40);
    expect(g.hits).toHaveLength(MAX_PER_GROUP);
    expect(totalMatches([g])).toBe(40);
  });

  it('skips blank scroll lines', () => {
    expect(scrollEntries(FULL)).toHaveLength(3);
  });
});

describe('snippet', () => {
  it('marks every occurrence of every word', () => {
    const s = snippet('The Spirit of God and the spirit of life', ['spirit']);
    expect(s.segments.filter((x) => x.mark).map((x) => x.text)).toEqual(['Spirit', 'spirit']);
    expect(s.cutStart).toBe(false);
    expect(s.cutEnd).toBe(false);
  });

  it('keeps the original casing and accents in the marked text', () => {
    const s = snippet('Un Élan fort', ['elan']);
    expect(s.segments.find((x) => x.mark)?.text).toBe('Élan');
  });

  it('windows a long text around the first match and flags the cut ends', () => {
    const text = `${'a '.repeat(200)}needle${' b'.repeat(200)}`;
    const s = snippet(text, ['needle']);
    const joined = s.segments.map((x) => x.text).join('');
    expect(joined.length).toBeLessThan(text.length);
    expect(joined).toContain('needle');
    expect(s.cutStart).toBe(true);
    expect(s.cutEnd).toBe(true);
  });

  it('merges overlapping matches into one mark', () => {
    const s = snippet('spiritual spirit', ['spirit', 'spiritual']);
    expect(s.segments.filter((x) => x.mark).map((x) => x.text)).toEqual(['spiritual', 'spirit']);
  });

  it('reassembles to the original text when it is short', () => {
    const text = 'Paul, a servant of Christ Jesus';
    expect(
      snippet(text, ['servant'])
        .segments.map((x) => x.text)
        .join(''),
    ).toBe(text);
  });
});

describe('performance', () => {
  it('searches a 350 KB scroll quickly', () => {
    const line = 'In the beginning was the Word and the Word was with God. ';
    const text = Array.from({ length: 6000 }, (_, i) => `${line}${i}`).join('\n');
    const big = bundle({
      scroll: loaded({ id: 's1', status: 'ready', scrollText: text } as never),
    });
    const entries = scrollEntries(big);
    const start = performance.now();
    const groups = search(entries, 'word god');
    const ms = performance.now() - start;
    expect(groups[0].total).toBe(6000);
    expect(ms).toBeLessThan(500);
  });
});
