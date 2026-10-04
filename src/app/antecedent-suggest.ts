import { PRONOUN_DICTIONARY } from './pronoun-dictionary';

/** A capitalised word candidate: an initial-capital, otherwise-lowercase run (e.g. "Paul"). */
const CAPITALISED_WORD = /[A-Z][a-z]+/g;

/** Characters that end a sentence; a capital immediately after one may be only sentence-initial. */
const SENTENCE_END = /[.!?]/;

/**
 * Distinct candidate antecedent terms extracted from scroll text, sorted ascending, de-duplicated
 * case-insensitively (keeping the first-seen casing), excluding pronoun-dictionary words. Pure,
 * deterministic, O(n); never throws; `''` → `[]`.
 *
 * Heuristic: collect capitalised word tokens (`[A-Z][a-z]+`) that are not *sentence-initial-only*
 * — a candidate is kept if it ever appears somewhere not immediately after sentence-ending
 * punctuation, OR appears more than once. Pronoun-dictionary words (shared with `parsePronouns`)
 * are never offered as antecedents. These are suggestions, not authoritative parsing — the
 * dropdown is user-editable, so a miss (lower-case or multi-word antecedents) is edited by hand.
 */
export function suggestAntecedents(text: string): string[] {
  // Per candidate lower-cased key: first-seen casing, whether seen outside a sentence start,
  // and total appearances.
  const seen = new Map<
    string,
    { casing: string; appearedMidSentence: boolean; appearances: number }
  >();

  for (const match of text.matchAll(CAPITALISED_WORD)) {
    const token = match[0];
    const lower = token.toLowerCase();
    if (PRONOUN_DICTIONARY.has(lower)) {
      continue;
    }

    // Is this appearance only a sentence-initial capital? Look back past whitespace for a
    // sentence-ending punctuation mark (or the start of the text).
    let i = match.index - 1;
    while (i >= 0 && /\s/.test(text[i])) {
      i--;
    }
    const sentenceInitial = i < 0 || SENTENCE_END.test(text[i]);

    const existing = seen.get(lower);
    if (existing) {
      existing.appearances++;
      existing.appearedMidSentence ||= !sentenceInitial;
    } else {
      seen.set(lower, {
        casing: token,
        appearedMidSentence: !sentenceInitial,
        appearances: 1,
      });
    }
  }

  return [...seen.values()]
    .filter((entry) => entry.appearedMidSentence || entry.appearances > 1)
    .map((entry) => entry.casing)
    .sort((a, b) => a.localeCompare(b));
}
