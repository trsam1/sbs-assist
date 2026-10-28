import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InterrogationStudyService } from './interrogation-study.service';
import { InterrogationStudy } from './models';
import { environment } from './environment';

describe('InterrogationStudyService', () => {
  let service: InterrogationStudyService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InterrogationStudyService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('get GETs /scroll-studies/{id}/interrogate and coerces absent entries/tags to []', () => {
    let result: InterrogationStudy | undefined;
    service.get('s1').subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/interrogate`);
    expect(req.request.method).toBe('GET');
    // A partial record with a missing entries field and an entry missing tags.
    req.flush({
      scrollStudyId: 's1',
      userId: 'u1',
      entries: [{ question: 'Q', category: 'why', passageRef: '', answer: '', notes: '' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result?.entries[0].tags).toEqual([]);
  });

  it('get coerces an entirely missing entries list to []', () => {
    let result: InterrogationStudy | undefined;
    service.get('s1').subscribe((s) => (result = s));
    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/interrogate`);
    req.flush({
      scrollStudyId: 's1',
      userId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result?.entries).toEqual([]);
  });

  it('save PUTs the input to /scroll-studies/{id}/interrogate', () => {
    const input = {
      entries: [
        {
          question: 'Why here?',
          category: 'why',
          tags: ['about-god'],
          passageRef: '2:7',
          answer: 'a',
          notes: '',
        },
      ],
    };
    let result: InterrogationStudy | undefined;
    service.save('s1', input).subscribe((s) => (result = s));

    const req = httpTesting.expectOne(`${environment.apiUrl}/scroll-studies/s1/interrogate`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(input);
    req.flush({
      scrollStudyId: 's1',
      userId: 'u1',
      entries: input.entries,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result?.entries.length).toBe(1);
  });
});
