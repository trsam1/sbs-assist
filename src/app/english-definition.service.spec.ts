import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnglishDefinitionService } from './english-definition.service';

describe('EnglishDefinitionService', () => {
  let service: EnglishDefinitionService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(EnglishDefinitionService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return the first definition from the API response', () => {
    service.fetchEnglishDefinition('love').subscribe((result) => {
      expect(result).toBe('an intense feeling of deep affection');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/love',
    );
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        meanings: [
          {
            definitions: [
              { definition: 'an intense feeling of deep affection' },
              { definition: 'a great interest and pleasure in something' },
            ],
          },
        ],
      },
    ]);
  });

  it('should return fallback when API returns an error', () => {
    service.fetchEnglishDefinition('xyznotaword').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/xyznotaword',
    );
    req.flush('Not Found', { status: 404, statusText: 'Not Found' });
  });

  it('should return fallback for empty string input', () => {
    service.fetchEnglishDefinition('').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    httpTesting.expectNone(
      'https://api.dictionaryapi.dev/api/v2/entries/en/',
    );
  });

  it('should return fallback for whitespace-only input', () => {
    service.fetchEnglishDefinition('   ').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    httpTesting.expectNone(
      'https://api.dictionaryapi.dev/api/v2/entries/en/',
    );
  });

  it('should return fallback when API response has empty meanings', () => {
    service.fetchEnglishDefinition('test').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/test',
    );
    req.flush([{ meanings: [] }]);
  });

  it('should return fallback when API response has empty definitions', () => {
    service.fetchEnglishDefinition('test').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/test',
    );
    req.flush([{ meanings: [{ definitions: [] }] }]);
  });

  it('should return fallback when API returns empty array', () => {
    service.fetchEnglishDefinition('test').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/test',
    );
    req.flush([]);
  });

  it('should URL-encode the word', () => {
    service.fetchEnglishDefinition('ice cream').subscribe();

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/ice%20cream',
    );
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        meanings: [
          { definitions: [{ definition: 'a frozen dessert' }] },
        ],
      },
    ]);
  });

  it('should trim the input word before making the request', () => {
    service.fetchEnglishDefinition('  love  ').subscribe((result) => {
      expect(result).toBe('a feeling of affection');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/love',
    );
    req.flush([
      {
        meanings: [
          { definitions: [{ definition: 'a feeling of affection' }] },
        ],
      },
    ]);
  });

  it('should return fallback when API returns a 500 server error', () => {
    service.fetchEnglishDefinition('love').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/love',
    );
    req.flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
  });

  it('should return fallback on network error', () => {
    service.fetchEnglishDefinition('love').subscribe((result) => {
      expect(result).toBe('Definition not available');
    });

    const req = httpTesting.expectOne(
      'https://api.dictionaryapi.dev/api/v2/entries/en/love',
    );
    req.error(new ProgressEvent('error'));
  });
});
