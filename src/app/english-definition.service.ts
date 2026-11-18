import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

/** A single definition within a meaning group. */
export interface EnglishDefinitionEntry {
  definition: string;
  example?: string;
}

/** A group of definitions for a specific part of speech. */
export interface EnglishMeaning {
  partOfSpeech: string;
  definitions: EnglishDefinitionEntry[];
}

/** Full structured dictionary result. */
export interface EnglishDictionaryResult {
  word: string;
  phonetic?: string;
  meanings: EnglishMeaning[];
}

/** Response shape from the free Dictionary API. */
interface DictionaryApiEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings: {
    partOfSpeech: string;
    definitions: {
      definition: string;
      example?: string;
    }[];
  }[];
}

const EMPTY_RESULT: EnglishDictionaryResult = {
  word: '',
  meanings: [],
};

/**
 * The outcome of a dictionary lookup. "Not found" (the word has no entry) is different from "error" (the
 * dictionary could not be reached or failed), because only the second is worth retrying.
 */
export type EnglishLookup =
  | { status: 'found'; result: EnglishDictionaryResult }
  | { status: 'not-found' }
  | { status: 'error' };

@Injectable({ providedIn: 'root' })
export class EnglishDefinitionService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'https://api.dictionaryapi.dev/api/v2/entries/en';

  /**
   * Look a word up and say what happened: found, no entry, or a failure worth retrying. Never throws.
   * A 404 from the dictionary means no entry; a network failure, timeout, rate limit or server error is an
   * error.
   */
  lookupEnglishDefinition(word: string): Observable<EnglishLookup> {
    const trimmed = word.trim();
    if (!trimmed) {
      return of<EnglishLookup>({ status: 'not-found' });
    }

    return this.http
      .get<DictionaryApiEntry[]>(`${this.apiUrl}/${encodeURIComponent(trimmed)}`)
      .pipe(
        map((entries): EnglishLookup => {
          const entry = entries?.[0];
          if (!entry || !Array.isArray(entry.meanings) || entry.meanings.length === 0) {
            return { status: 'not-found' };
          }

          const phonetic =
            entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || undefined;

          const meanings: EnglishMeaning[] = entry.meanings.map((m) => ({
            partOfSpeech: m.partOfSpeech,
            definitions: m.definitions.map((d) => ({
              definition: d.definition,
              example: d.example,
            })),
          }));

          return { status: 'found', result: { word: entry.word, phonetic, meanings } };
        }),
        catchError((err: { status?: number }) =>
          of<EnglishLookup>({ status: err?.status === 404 ? 'not-found' : 'error' }),
        ),
      );
  }

  /**
   * Fetch the full English dictionary data for a word.
   * Never throws: returns an empty result when there is no entry or the lookup failed. Callers that need
   * to tell those apart (to offer a retry) use `lookupEnglishDefinition`.
   */
  fetchEnglishDefinition(word: string): Observable<EnglishDictionaryResult> {
    return this.lookupEnglishDefinition(word).pipe(
      map((lookup) => (lookup.status === 'found' ? lookup.result : EMPTY_RESULT)),
    );
  }
}
