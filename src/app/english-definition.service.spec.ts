import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnglishDefinitionService, EnglishDictionaryResult } from './english-definition.service';

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const EMPTY: EnglishDictionaryResult = { word: '', meanings: [] };

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

  /** Subscribes and returns a getter, so assertions run outside `subscribe`. */
  function fetch(word: string): () => EnglishDictionaryResult | undefined {
    let result: EnglishDictionaryResult | undefined;
    service.fetchEnglishDefinition(word).subscribe((r) => (result = r));
    return () => result;
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('maps the first API entry to the structured result', () => {
    const result = fetch('love');

    const req = httpTesting.expectOne(`${API}/love`);
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        word: 'love',
        phonetic: '/lʌv/',
        meanings: [
          {
            partOfSpeech: 'noun',
            definitions: [
              { definition: 'an intense feeling of deep affection', example: 'babies fill parents with love' },
            ],
          },
        ],
      },
    ]);

    expect(result()).toEqual({
      word: 'love',
      phonetic: '/lʌv/',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            { definition: 'an intense feeling of deep affection', example: 'babies fill parents with love' },
          ],
        },
      ],
    });
  });

  it('falls back to phonetics[].text when phonetic is missing', () => {
    const result = fetch('love');

    httpTesting.expectOne(`${API}/love`).flush([
      {
        word: 'love',
        phonetics: [{}, { text: '/lʌv/' }],
        meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'feel deep affection for' }] }],
      },
    ]);

    expect(result()).toEqual({
      word: 'love',
      phonetic: '/lʌv/',
      meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'feel deep affection for', example: undefined }] }],
    });
  });

  it('returns the empty result on a 404', () => {
    const result = fetch('xyznotaword');
    httpTesting.expectOne(`${API}/xyznotaword`).flush('Not Found', { status: 404, statusText: 'Not Found' });
    expect(result()).toEqual(EMPTY);
  });

  it('returns the empty result on a 500', () => {
    const result = fetch('love');
    httpTesting
      .expectOne(`${API}/love`)
      .flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    expect(result()).toEqual(EMPTY);
  });

  it('returns the empty result on a network error', () => {
    const result = fetch('love');
    httpTesting.expectOne(`${API}/love`).error(new ProgressEvent('error'));
    expect(result()).toEqual(EMPTY);
  });

  it('returns the empty result when the API returns an empty array', () => {
    const result = fetch('test');
    httpTesting.expectOne(`${API}/test`).flush([]);
    expect(result()).toEqual(EMPTY);
  });

  it('returns the empty result for empty input without a request', () => {
    const result = fetch('');
    httpTesting.expectNone(`${API}/`);
    expect(result()).toEqual(EMPTY);
  });

  it('returns the empty result for whitespace-only input without a request', () => {
    const result = fetch('   ');
    httpTesting.expectNone(`${API}/`);
    expect(result()).toEqual(EMPTY);
  });

  it('returns the word with no meanings when the API entry has empty meanings', () => {
    const result = fetch('test');
    httpTesting.expectOne(`${API}/test`).flush([{ word: 'test', meanings: [] }]);
    expect(result()).toEqual({ word: 'test', phonetic: undefined, meanings: [] });
  });

  it('URL-encodes the word', () => {
    fetch('ice cream');
    const req = httpTesting.expectOne(`${API}/ice%20cream`);
    expect(req.request.method).toBe('GET');
    req.flush([{ word: 'ice cream', meanings: [] }]);
  });

  it('trims the input word before making the request', () => {
    const result = fetch('  love  ');
    httpTesting.expectOne(`${API}/love`).flush([
      { word: 'love', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'a feeling of affection' }] }] },
    ]);
    expect(result()?.meanings[0].definitions[0].definition).toBe('a feeling of affection');
  });
});
