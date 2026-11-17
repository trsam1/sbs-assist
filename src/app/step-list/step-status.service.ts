import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { AntecedentStudyService } from '../antecedent-study.service';
import { FiguresStudyService } from '../figures-study.service';
import { InterrogationStudyService } from '../interrogation-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { OutlineStudyService } from '../outline-study.service';
import { StructureStudyService } from '../structure-study.service';
import { isDue, readSchedule } from '../memorize-view/srs';
import { MemorizationStudy } from '../models';

/** What Book home knows about a step: saved work exists, none yet, or could not be read. */
export type StepStatus = 'in-progress' | 'not-started' | 'unknown';

export interface StepStatuses {
  /** Keyed by catalog step id. Steps without a saved study of their own are absent. */
  statuses: Record<string, StepStatus>;
  /** Chunks due today, or null when there is no memorization study. */
  memorizeDue: number | null;
}

/** Map one "get saved study" call to a status: a result is in-progress, a 404 is not-started. */
export function toStatus<T>(
  call: Observable<T>,
): Observable<{ status: StepStatus; value: T | null }> {
  return call.pipe(
    map((value) => ({ status: 'in-progress' as StepStatus, value })),
    catchError((err: { status?: number }) =>
      of({ status: (err?.status === 404 ? 'not-started' : 'unknown') as StepStatus, value: null }),
    ),
  );
}

/** Count chunks due on `today` in a memorization study. */
export function dueCount(study: MemorizationStudy, today: Date): number {
  return study.chunks.filter((c) => isDue(readSchedule(c), today)).length;
}

/**
 * Reads each step's existing "get saved study" endpoint in parallel to show progress on Book home and
 * the scroll page. No new API; one failing call only makes that step show as unknown.
 */
@Injectable({ providedIn: 'root' })
export class StepStatusService {
  private readonly antecedents = inject(AntecedentStudyService);
  private readonly structure = inject(StructureStudyService);
  private readonly outline = inject(OutlineStudyService);
  private readonly figures = inject(FiguresStudyService);
  private readonly interrogation = inject(InterrogationStudyService);
  private readonly memorization = inject(MemorizationStudyService);

  load(scrollStudyId: string, today: Date = new Date()): Observable<StepStatuses> {
    return forkJoin({
      antecedents: toStatus(this.antecedents.get(scrollStudyId)),
      structure: toStatus(this.structure.get(scrollStudyId)),
      outline: toStatus(this.outline.get(scrollStudyId)),
      figures: toStatus(this.figures.get(scrollStudyId)),
      interrogate: toStatus(this.interrogation.get(scrollStudyId)),
      memorize: toStatus(this.memorization.get(scrollStudyId)),
    }).pipe(
      map((r) => {
        const statuses: Record<string, StepStatus> = {
          antecedents: r.antecedents.status,
          structure: r.structure.status,
          outline: r.outline.status,
          // Theme and purpose live on the outline page, so they share its saved study.
          theme: r.outline.status,
          figures: r.figures.status,
          interrogate: r.interrogate.status,
          memorize: r.memorize.status,
        };
        return {
          statuses,
          memorizeDue: r.memorize.value ? dueCount(r.memorize.value, today) : null,
        };
      }),
    );
  }
}
