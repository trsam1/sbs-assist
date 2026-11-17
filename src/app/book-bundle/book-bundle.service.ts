import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { AntecedentStudyService } from '../antecedent-study.service';
import { FiguresStudyService } from '../figures-study.service';
import { InterrogationStudyService } from '../interrogation-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { BookStudy } from '../models';
import { OutlineStudyService } from '../outline-study.service';
import { ScrollStudyService } from '../scroll-study.service';
import { StructureStudyService } from '../structure-study.service';
import { StudyCrudService } from '../study-crud.service';
import {
  BookBundle,
  Part,
  empty,
  hasAntecedents,
  hasChunks,
  hasEntries,
  hasOutline,
  hasStructure,
} from './book-bundle';

/** One call to a part: a result with content is loaded, with none is empty, a 404 is empty, else failed. */
export function toPart<T>(call: Observable<T>, hasContent: (v: T) => boolean): Observable<Part<T>> {
  return call.pipe(
    map((data): Part<T> => ({ status: hasContent(data) ? 'loaded' : 'empty', data })),
    catchError((err: { status?: number }) =>
      of<Part<T>>({ status: err?.status === 404 ? 'empty' : 'failed', data: null }),
    ),
  );
}

/**
 * Loads everything the app stores for one book, in parallel, through the same GET endpoints the tool pages
 * use. No new endpoint. A failing call only marks its own part as failed.
 */
@Injectable({ providedIn: 'root' })
export class BookBundleService {
  private readonly scrolls = inject(ScrollStudyService);
  private readonly words = inject(StudyCrudService);
  private readonly antecedents = inject(AntecedentStudyService);
  private readonly structure = inject(StructureStudyService);
  private readonly outline = inject(OutlineStudyService);
  private readonly figures = inject(FiguresStudyService);
  private readonly interrogation = inject(InterrogationStudyService);
  private readonly memorization = inject(MemorizationStudyService);

  /** `scrollStudyId` is '' when the book has no scroll yet; the scroll-based parts are then empty. */
  load(book: BookStudy, scrollStudyId: string): Observable<BookBundle> {
    const hasScroll = scrollStudyId.length > 0;
    const forScroll = <T>(call: () => Observable<T>, has: (v: T) => boolean) =>
      hasScroll ? toPart(call(), has) : of(empty<T>());

    return forkJoin({
      scroll: forScroll(
        () => this.scrolls.getScrollStudy(scrollStudyId),
        (s) => s.status === 'ready',
      ),
      wordStudies: toPart(
        this.words
          .listStudies()
          .pipe(map((all) => all.filter((s) => (s.bookStudyIds ?? []).includes(book.id)))),
        (list) => list.length > 0,
      ),
      antecedents: forScroll(() => this.antecedents.get(scrollStudyId), hasAntecedents),
      structure: forScroll(() => this.structure.get(scrollStudyId), hasStructure),
      outline: forScroll(() => this.outline.get(scrollStudyId), hasOutline),
      figures: forScroll(() => this.figures.get(scrollStudyId), hasEntries),
      interrogation: forScroll(() => this.interrogation.get(scrollStudyId), hasEntries),
      memorization: forScroll(() => this.memorization.get(scrollStudyId), hasChunks),
    }).pipe(map((parts) => ({ book, ...parts })));
  }
}
