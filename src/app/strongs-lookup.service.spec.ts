import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach } from 'vitest';
import { StrongsLookupService } from './strongs-lookup.service';
import { StrongsStudyResult, CrossReference } from './models';
import { environment } from './environment';

describe('StrongsLookupService', () => {
  let service: StrongsLookupService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(StrongsLookupService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  describe('getStrongsStudyData', () => {
    it("should fetch Strong's data for a given number", () => {
      const mockResult: StrongsStudyResult = {
        strongsNumber: 'G25',
        definition: 'to love',
        originalWord: 'ἀγαπάω',
        transliteration: 'agapaō',
        lexiconEntry: 'From ἀγάπη; to love...',
      };

      service.getStrongsStudyData('G25').subscribe((result) => {
        expect(result).toEqual(mockResult);
      });

      const req = httpTesting.expectOne(`${environment.apiUrl}/strongs/G25`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResult);
    });

    it('should use the correct URL for Hebrew numbers', () => {
      service.getStrongsStudyData('H157').subscribe();

      const req = httpTesting.expectOne(`${environment.apiUrl}/strongs/H157`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });

  describe('getCrossReferences', () => {
    it("should fetch cross-references for a given Strong's number", () => {
      const mockRefs: CrossReference[] = [
        { reference: 'Romans 5:8', notes: '' },
        { reference: 'John 3:16', notes: '' },
      ];

      service.getCrossReferences('G25').subscribe((result) => {
        expect(result).toEqual(mockRefs);
      });

      const req = httpTesting.expectOne(`${environment.apiUrl}/strongs/G25/cross-references`);
      expect(req.request.method).toBe('GET');
      req.flush(mockRefs);
    });

    it('should return empty array when no cross-references exist', () => {
      service.getCrossReferences('G9999').subscribe((result) => {
        expect(result).toEqual([]);
      });

      const req = httpTesting.expectOne(`${environment.apiUrl}/strongs/G9999/cross-references`);
      req.flush([]);
    });
  });
});
