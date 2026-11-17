import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { AntecedentStudyService } from '../antecedent-study.service';
import { FiguresStudyService } from '../figures-study.service';
import { InterrogationStudyService } from '../interrogation-study.service';
import { MemorizationStudyService } from '../memorization-study.service';
import { MemorizationStudy } from '../models';
import { OutlineStudyService } from '../outline-study.service';
import { StructureStudyService } from '../structure-study.service';
import { StepStatuses, StepStatusService, dueCount, toStatus } from './step-status.service';

function memStudy(dueDates: string[]): MemorizationStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u',
    chunks: dueDates.map((d, i) => ({
      id: `c${i}`,
      verseRef: `1:${i + 1}`,
      text: 't',
      state: 'new',
      ...(d ? { dueDate: d } : {}),
    })) as unknown as MemorizationStudy['chunks'],
    createdAt: '',
    updatedAt: '',
  };
}

describe('toStatus', () => {
  it('maps a result to in-progress, a 404 to not-started and other errors to unknown', () => {
    let a: unknown;
    let b: unknown;
    let c: unknown;
    toStatus(of({ x: 1 })).subscribe((v) => (a = v));
    toStatus(throwError(() => ({ status: 404 }))).subscribe((v) => (b = v));
    toStatus(throwError(() => ({ status: 500 }))).subscribe((v) => (c = v));
    expect(a).toEqual({ status: 'in-progress', value: { x: 1 } });
    expect(b).toEqual({ status: 'not-started', value: null });
    expect(c).toEqual({ status: 'unknown', value: null });
  });
});

describe('dueCount', () => {
  it('counts never-reviewed chunks and those due today or earlier', () => {
    const today = new Date(2026, 10, 17);
    expect(dueCount(memStudy(['', '2026-11-17', '2026-11-10', '2026-11-18']), today)).toBe(3);
  });
});

describe('StepStatusService', () => {
  let service: StepStatusService;

  function provide(over: { outline?: unknown; memorize?: unknown; structure?: unknown }): void {
    const nf = () => throwError(() => ({ status: 404 }));
    TestBed.configureTestingModule({
      providers: [
        { provide: AntecedentStudyService, useValue: { get: nf } },
        { provide: StructureStudyService, useValue: { get: () => over.structure ?? nf() } },
        { provide: OutlineStudyService, useValue: { get: () => over.outline ?? nf() } },
        { provide: FiguresStudyService, useValue: { get: nf } },
        { provide: InterrogationStudyService, useValue: { get: nf } },
        { provide: MemorizationStudyService, useValue: { get: () => over.memorize ?? nf() } },
      ],
    });
    service = TestBed.inject(StepStatusService);
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('reports in-progress, not-started and unknown from the saved-study calls', () => {
    provide({
      outline: of({}),
      structure: throwError(() => ({ status: 500 })),
      memorize: of(memStudy(['2026-11-01', '2027-01-01'])),
    });
    let out: StepStatuses | undefined;
    service.load('s1', new Date(2026, 10, 17)).subscribe((r) => (out = r));
    expect(out).toEqual({
      statuses: {
        antecedents: 'not-started',
        structure: 'unknown',
        outline: 'in-progress',
        theme: 'in-progress',
        figures: 'not-started',
        interrogate: 'not-started',
        memorize: 'in-progress',
      },
      memorizeDue: 1,
    });
  });

  it('reports no due count when there is no memorization study', () => {
    provide({});
    let due: number | null | undefined;
    service.load('s1').subscribe((r) => (due = r.memorizeDue));
    expect(due).toBeNull();
  });
});
