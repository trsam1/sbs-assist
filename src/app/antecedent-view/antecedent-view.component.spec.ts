import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { AntecedentViewComponent } from './antecedent-view.component';
import { ScrollStudy, ScrollStudyService } from '../scroll-study.service';
import { AntecedentStudyService } from '../antecedent-study.service';
import { AntecedentStudy } from '../models';

function makeStudy(overrides: Partial<ScrollStudy> = {}): ScrollStudy {
  return {
    id: 's1',
    userId: 'u1',
    bookName: 'John',
    status: 'ready',
    scrollText: 'He saw them, and they saw him.',
    truncated: false,
    failureReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeAntecedentStudy(overrides: Partial<AntecedentStudy> = {}): AntecedentStudy {
  return {
    scrollStudyId: 's1',
    userId: 'u1',
    assignments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('AntecedentViewComponent', () => {
  let fixture: ComponentFixture<AntecedentViewComponent>;
  let component: AntecedentViewComponent;
  let getScrollSpy: ReturnType<typeof vi.fn>;
  let getAntSpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;
  let scrollService: Partial<ScrollStudyService>;
  let antService: Partial<AntecedentStudyService>;

  function configure(): void {
    getScrollSpy = vi.fn();
    getAntSpy = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    saveSpy = vi.fn().mockReturnValue(of(undefined));
    scrollService = {
      getScrollStudy: getScrollSpy as unknown as ScrollStudyService['getScrollStudy'],
    };
    antService = {
      get: getAntSpy as unknown as AntecedentStudyService['get'],
      save: saveSpy as unknown as AntecedentStudyService['save'],
    };
    TestBed.configureTestingModule({
      imports: [AntecedentViewComponent],
      providers: [
        provideRouter([]),
        { provide: ScrollStudyService, useValue: scrollService },
        { provide: AntecedentStudyService, useValue: antService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['scrollStudyId', 's1']]) } },
        },
      ],
    });
    fixture = TestBed.createComponent(AntecedentViewComponent);
    component = fixture.componentInstance;
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function queryAll(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders one row per pronoun occurrence in reading order, each with a snippet', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    expect(component.state()).toBe('ready');
    const rows = queryAll('[data-testid="antecedent-row"]');
    // "He saw them, and they saw him." → he, them, they, him (4 occurrences in reading order)
    expect(rows).toHaveLength(4);
    const words = queryAll('[data-testid="antecedent-word"]').map((e) => e.textContent?.trim());
    expect(words).toEqual(['he', 'them', 'they', 'him']);
    const snippets = queryAll('[data-testid="antecedent-snippet"]').map((e) =>
      e.textContent?.trim(),
    );
    expect(snippets.every((s) => (s?.length ?? 0) > 0)).toBe(true);
  });

  it('treats two occurrences of the same word as independent rows', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ scrollText: 'He went. He stayed.' })));
    fixture.detectChanges();

    const rows = component.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0].word).toBe('he');
    expect(rows[1].word).toBe('he');

    component.setAntecedent(rows[0].occurrence, 'Jesus');
    expect(component.rows()[0].antecedent).toBe('Jesus');
    expect(component.rows()[1].antecedent).toBe(''); // the other "he" is unchanged
  });

  it('pre-fills matching rows from a saved study by occurrence', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getAntSpy.mockReturnValue(
      of(
        makeAntecedentStudy({
          assignments: [{ occurrence: 0, start: 0, word: 'he', antecedent: 'Jesus' }],
        }),
      ),
    );
    fixture.detectChanges();

    const rows = component.rows();
    expect(rows[0].antecedent).toBe('Jesus');
    expect(rows[1].antecedent).toBe('');
    // The saved value is also available as a dropdown option.
    expect(component.options()).toContain('Jesus');
  });

  it('ignores a stale saved assignment whose occurrence is not in the current parse', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ scrollText: 'He went.' }))); // one occurrence
    getAntSpy.mockReturnValue(
      of(
        makeAntecedentStudy({
          assignments: [
            { occurrence: 0, start: 0, word: 'he', antecedent: 'Jesus' },
            { occurrence: 99, start: 500, word: 'they', antecedent: 'the crowd' },
          ],
        }),
      ),
    );
    fixture.detectChanges();

    const rows = component.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].antecedent).toBe('Jesus');
    // No error, no extra row created for the stale occurrence.
    expect(component.state()).toBe('ready');
  });

  it('sets a row antecedent when an option is selected', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    const occ = component.rows()[0].occurrence;
    component.setAntecedent(occ, 'the Father');
    expect(component.rows()[0].antecedent).toBe('the Father');
  });

  it('adds a typed antecedent as a de-duped option and sets it on the row', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    const occ0 = component.rows()[0].occurrence;
    const occ1 = component.rows()[1].occurrence;
    component.setDraft(occ0, '  the Son  ');
    component.addAntecedent(occ0);
    expect(component.rows()[0].antecedent).toBe('the Son'); // trimmed
    expect(component.options()).toContain('the Son');

    // Adding the same value (different case) on another row does not duplicate the option.
    component.setDraft(occ1, 'THE SON');
    component.addAntecedent(occ1);
    expect(component.options().filter((o) => o.toLowerCase() === 'the son')).toHaveLength(1);
  });

  it('clears a selection when "— none —" is selected or an all-whitespace value is added', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    const occ = component.rows()[0].occurrence;
    component.setAntecedent(occ, 'Jesus');
    component.setAntecedent(occ, ''); // selecting "— none —"
    expect(component.rows()[0].antecedent).toBe('');

    component.setAntecedent(occ, 'Jesus');
    component.setDraft(occ, '   ');
    component.addAntecedent(occ); // whitespace-only Add clears
    expect(component.rows()[0].antecedent).toBe('');
  });

  it('saves only non-empty assignments carrying occurrence/start/word and reports success', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    fixture.detectChanges();

    const rows = component.rows();
    component.setAntecedent(rows[0].occurrence, 'Jesus');
    component.save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [id, assignments] = saveSpy.mock.calls[0];
    expect(id).toBe('s1');
    expect(assignments).toEqual([
      {
        occurrence: rows[0].occurrence,
        start: rows[0].start,
        word: rows[0].word,
        antecedent: 'Jesus',
      },
    ]);
    fixture.detectChanges();
    expect(query('[data-testid="antecedent-saved"]')).not.toBeNull();
  });

  it('calls save with [] when every selection is cleared (empty-worksheet save)', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getAntSpy.mockReturnValue(
      of(
        makeAntecedentStudy({
          assignments: [{ occurrence: 0, start: 0, word: 'he', antecedent: 'Jesus' }],
        }),
      ),
    );
    fixture.detectChanges();

    component.setAntecedent(component.rows()[0].occurrence, ''); // clear the one assignment
    component.save();
    expect(saveSpy).toHaveBeenCalledWith('s1', []);
  });

  it('keeps selections editable and shows an error when save fails', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    saveSpy.mockReturnValue(throwError(() => ({ status: 500 })));
    fixture.detectChanges();

    const occ = component.rows()[0].occurrence;
    component.setAntecedent(occ, 'Jesus');
    component.save();
    fixture.detectChanges();

    expect(query('[data-testid="antecedent-save-error"]')).not.toBeNull();
    expect(component.rows()[0].antecedent).toBe('Jesus'); // not discarded
    expect(component.saving()).toBe(false);
  });

  it('shows the preparing state for an extracting study with a back link to the scroll', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ status: 'extracting', scrollText: '' })));
    fixture.detectChanges();

    expect(component.state()).toBe('preparing');
    const back = query('[data-testid="antecedent-preparing-back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/scroll/s1');
    expect(query('[data-testid="antecedent-table"]')).toBeNull();
  });

  it('shows the preparing state for an uploading study', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ status: 'uploading', scrollText: '' })));
    fixture.detectChanges();
    expect(component.state()).toBe('preparing');
  });

  it('treats a 404 scroll as a terminal failed state with a link to /scrolls', () => {
    configure();
    getScrollSpy.mockReturnValue(throwError(() => ({ status: 404 })));
    fixture.detectChanges();

    expect(component.state()).toBe('failed');
    const back = query('[data-testid="antecedent-failed-back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/scrolls');
  });

  it('shows the failed state for a failed scroll with its reason', () => {
    configure();
    getScrollSpy.mockReturnValue(
      of(makeStudy({ status: 'failed', failureReason: 'file too large', scrollText: '' })),
    );
    fixture.detectChanges();
    expect(component.state()).toBe('failed');
    expect(query('[data-testid="antecedent-failed"]')?.textContent).toContain('file too large');
  });

  it('treats a non-404 load failure as a recoverable error with a working Retry', () => {
    configure();
    getScrollSpy
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValueOnce(of(makeStudy()));
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    (query('[data-testid="antecedent-retry-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getScrollSpy).toHaveBeenCalledTimes(2);
    expect(component.state()).toBe('ready');
  });

  it('shows the empty state with no Save when the scroll has no pronouns', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy({ scrollText: 'In the beginning' })));
    fixture.detectChanges();

    expect(query('[data-testid="antecedent-empty"]')).not.toBeNull();
    expect(query('[data-testid="antecedent-table"]')).toBeNull();
    expect(query('[data-testid="antecedent-save"]')).toBeNull();
  });

  it('calls only getScrollStudy and the two AntecedentStudyService methods', () => {
    configure();
    getScrollSpy.mockReturnValue(of(makeStudy()));
    getAntSpy.mockReturnValue(of(makeAntecedentStudy()));
    fixture.detectChanges();

    expect(getScrollSpy).toHaveBeenCalledWith('s1');
    expect(getAntSpy).toHaveBeenCalledWith('s1');
    expect(Object.keys(scrollService)).toEqual(['getScrollStudy']);
    expect(Object.keys(antService).sort()).toEqual(['get', 'save']);
  });
});
