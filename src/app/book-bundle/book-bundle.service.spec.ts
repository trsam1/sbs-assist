import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { AntecedentStudyService } from '../antecedent-study.service';
import { FiguresStudyService } from '../figures-study.service';
import { InterrogationStudyService } from '../interrogation-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { BookStudy, StudyWorksheet } from '../models';
import { OutlineStudyService } from '../outline-study.service';
import { ScrollStudyService } from '../scroll-study.service';
import { StructureStudyService } from '../structure-study.service';
import { StudyCrudService } from '../study-crud.service';
import { BookBundle } from './book-bundle';
import { BookBundleService, toPart } from './book-bundle.service';

const BOOK = {
  id: 'b1',
  book: 'Romans',
  title: '',
  notes: '',
  referents: [],
} as unknown as BookStudy;
const notFound = () => throwError(() => ({ status: 404 }));
const boom = () => throwError(() => ({ status: 500 }));

describe('toPart', () => {
  it('is loaded with content, empty without, empty on 404, failed on other errors', () => {
    const got: string[] = [];
    toPart(of([1]), (v) => v.length > 0).subscribe((p) => got.push(p.status));
    toPart(of([]), (v: number[]) => v.length > 0).subscribe((p) => got.push(p.status));
    toPart(notFound(), () => true).subscribe((p) => got.push(p.status));
    toPart(boom(), () => true).subscribe((p) => got.push(p.status));
    expect(got).toEqual(['loaded', 'empty', 'empty', 'failed']);
  });
});

describe('BookBundleService', () => {
  const calls: string[] = [];
  let svc: BookBundleService;

  function provide(over: Record<string, () => Observable<unknown>> = {}): void {
    calls.length = 0;
    const mk = (name: string, fallback: () => Observable<unknown>) => () => {
      calls.push(name);
      return (over[name] ?? fallback)();
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ScrollStudyService,
          useValue: {
            getScrollStudy: mk('scroll', () => of({ id: 's1', status: 'ready', scrollText: 'x' })),
          },
        },
        { provide: StudyCrudService, useValue: { listStudies: mk('words', () => of([])) } },
        {
          provide: AntecedentStudyService,
          useValue: { get: mk('antecedents', () => of({ assignments: [{}] })) },
        },
        { provide: StructureStudyService, useValue: { get: mk('structure', notFound) } },
        {
          provide: OutlineStudyService,
          useValue: {
            get: mk('outline', () => of({ paragraphs: [], groupings: [], theme: '', purpose: '' })),
          },
        },
        {
          provide: FiguresStudyService,
          useValue: { get: mk('figures', () => of({ entries: [{}] })) },
        },
        { provide: InterrogationStudyService, useValue: { get: mk('interrogation', boom) } },
        {
          provide: MemorizationStudyService,
          useValue: { get: mk('memorization', () => of({ chunks: [{}] })) },
        },
      ],
    });
    svc = TestBed.inject(BookBundleService);
  }

  beforeEach(() => TestBed.resetTestingModule());

  function run(scrollId: string): BookBundle {
    let out: BookBundle | undefined;
    svc.load(BOOK, scrollId).subscribe((b) => (out = b));
    return out as BookBundle;
  }

  it('marks each part loaded, empty or failed independently', () => {
    provide();
    const b = run('s1');
    expect(b.scroll.status).toBe('loaded');
    expect(b.antecedents.status).toBe('loaded');
    expect(b.structure.status).toBe('empty'); // 404
    expect(b.outline.status).toBe('empty'); // exists but has nothing
    expect(b.figures.status).toBe('loaded');
    expect(b.interrogation.status).toBe('failed'); // 500
    expect(b.memorization.status).toBe('loaded');
    expect(b.wordStudies.status).toBe('empty');
  });

  it('makes no scroll-based calls when the book has no scroll', () => {
    provide();
    const b = run('');
    expect(calls).toEqual(['words']);
    expect(b.scroll.status).toBe('empty');
    expect(b.figures.status).toBe('empty');
  });

  it('treats a scroll that is not ready as empty', () => {
    provide({ scroll: () => of({ id: 's1', status: 'extracting', scrollText: '' }) });
    expect(run('s1').scroll.status).toBe('empty');
  });

  it('keeps only the word studies linked to this book, including multi-book ones', () => {
    const ws = (id: string, ids: string[]) =>
      ({ id, bookStudyIds: ids, wordStudies: [] }) as unknown as StudyWorksheet;
    provide({ words: () => of([ws('a', ['b1', 'b2']), ws('b', ['b2']), ws('c', [])]) });
    const b = run('s1');
    expect(b.wordStudies.status).toBe('loaded');
    expect(b.wordStudies.data?.map((s) => s.id)).toEqual(['a']);
  });

  it('marks word studies failed when the list call fails, without failing the rest', () => {
    provide({ words: boom });
    const b = run('s1');
    expect(b.wordStudies.status).toBe('failed');
    expect(b.figures.status).toBe('loaded');
  });

  it('makes one call per source, not more', () => {
    provide();
    run('s1');
    expect([...calls].sort()).toEqual(
      [
        'antecedents',
        'figures',
        'interrogation',
        'memorization',
        'outline',
        'scroll',
        'structure',
        'words',
      ].sort(),
    );
    expect(vi.isMockFunction(calls)).toBe(false);
  });
});
