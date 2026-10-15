/** Backend mirror of the frontend PRONOUN_TYPES (src/app/pronoun-type.ts). Values only — the hint
 *  text is frontend-only. Kept in sync by hand; a drift-guard test (pronoun-type.test.ts) asserts
 *  this equals the same literal the frontend ships. */
export const PRONOUN_TYPES: readonly string[] = [
  'Personal',
  'Demonstrative',
  'Indefinite',
  'Intensive',
  'Reflexive',
  'Interrogative',
  'Relative',
  'Reciprocal',
  'Quantifier',
];

/** True iff value is a member of the fixed pronoun-type list. */
export function isPronounType(value: unknown): boolean {
  return typeof value === 'string' && PRONOUN_TYPES.includes(value);
}
