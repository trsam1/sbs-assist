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

@Injectable({ providedIn: 'root' })
export class EnglishDefinitionService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'https://api.dictionaryapi.dev/api/v2/entries/en';

  /**
   * Fetch the full English dictionary data for a word.
   * Never throws — returns an empty result on failure.
   */
  fetchEnglishDefinition(word: string): Observable<EnglishDictionaryResult> {
    const trimmed = word.trim();
    if (!trimmed) {
      return of(EMPTY_RESULT);
    }

    return this.http
      .get<DictionaryApiEntry[]>(`${this.apiUrl}/${encodeURIComponent(trimmed)}`)
      .pipe(
        map((entries) => {
          const entry = entries?.[0];
          if (!entry) return EMPTY_RESULT;

          const phonetic = entry.phonetic
            || entry.phonetics?.find((p) => p.text)?.text
            || undefined;

          const meanings: EnglishMeaning[] = entry.meanings.map((m) => ({
            partOfSpeech: m.partOfSpeech,
            definitions: m.definitions.map((d) => ({
              definition: d.definition,
              example: d.example,
            })),
          }));

          return { word: entry.word, phonetic, meanings };
        }),
        catchError(() => of(EMPTY_RESULT)),
      );
  }
}
