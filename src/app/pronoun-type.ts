/** The fixed, closed set of grammatical pronoun types from the Step 6 reference's "Types of
 *  Pronouns" table (docs/references/inductive-study-step-6.md). Pure, no Angular, unit-testable. */

/** The nine grammatical pronoun types, in the reference's order. Not user-editable. */
export const PRONOUN_TYPES = [
  'Personal',
  'Demonstrative',
  'Indefinite',
  'Intensive',
  'Reflexive',
  'Interrogative',
  'Relative',
  'Reciprocal',
  'Quantifier',
] as const;

/** A member of the fixed pronoun-type list. */
export type PronounType = (typeof PRONOUN_TYPES)[number];

/** The unclassified sentinel used by the UI and persisted shape ('' = no type chosen). */
export const UNCLASSIFIED = '' as const;

/**
 * Short, copyright-free Use + Examples per type (keys === PRONOUN_TYPES), drawn from the Step 6
 * reference's "Types of Pronouns" table. Example words are pronoun lists, not verse quotations.
 */
export const PRONOUN_TYPE_HINTS: Readonly<Record<PronounType, string>> = {
  Personal:
    'Takes the place of nouns functioning as the subject, object, indirect object, subject ' +
    'complement, or object of a preposition. Examples: I, me, you, he, him, she, it, we, us, ' +
    'they, them, mine, yours, his, hers, its, ours, theirs.',
  Demonstrative:
    'Identifies specific persons or things and serves as the subject. Examples: this, that, ' +
    'these, those.',
  Indefinite:
    'Refers to unspecified persons or things. Examples: all, another, someone, somebody, ' +
    'something, most, each, one, any, anybody, anyone, anything, everybody, everyone, few, ' +
    'many, several, nobody, none, no one, neither, nothing.',
  Intensive:
    'Emphasizes the antecedent. Examples: myself, yourself, himself, herself, itself, ' +
    'ourselves, yourselves, themselves.',
  Reflexive:
    'Indicates that the subject acts upon itself. Examples: myself, yourself, himself, herself, ' +
    'itself, ourselves, yourselves, themselves.',
  Interrogative:
    'Introduces questions. Examples: who, what, whose, whom, which, whoever, whatever, whichever.',
  Relative:
    'Introduces dependent clauses. Examples: who, whose, whom, which, that, whoever, whomever, ' +
    'whichever, whosever.',
  Reciprocal: 'Expresses a reciprocal action or relationship. Examples: one another, each other.',
  Quantifier:
    'Expresses quantity. Examples: all, both, some, much, any, many, little, half, three, etc.',
};

/** True iff value is a member of the fixed type list. */
export function isPronounType(value: unknown): value is PronounType {
  return typeof value === 'string' && (PRONOUN_TYPES as readonly string[]).includes(value);
}

/** Normalize any stored value to a known type or '' (unclassified). Never throws. */
export function toPronounType(value: unknown): PronounType | '' {
  return isPronounType(value) ? value : UNCLASSIFIED;
}
