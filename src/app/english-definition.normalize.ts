import { EnglishDefinitionData } from './models';

/**
 * Tolerant reader for a stored `englishDefinition`.
 *
 * Studies saved before 2026-04-27 store a plain string; newer ones store the
 * structured object. Consumers always receive `EnglishDefinitionData | null`.
 * - non-empty string → one meaning with an empty part of speech
 * - object with an array `meanings` → returned as is
 * - anything else (including an empty string) → `null`
 */
export function normalizeEnglishDefinition(
  value: unknown,
  word: string,
): EnglishDefinitionData | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return { word, meanings: [{ partOfSpeech: '', definitions: [{ definition: trimmed }] }] };
  }
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { meanings?: unknown }).meanings)
  ) {
    return value as EnglishDefinitionData;
  }
  return null;
}
