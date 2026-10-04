/**
 * Fixed, client-owned dictionary of English pronouns and possessive adjectives for the Step 6
 * Pronoun Study tool (Identify Antecedents, Referents, Audience, and Speaker). The forms are taken
 * from the Step 6 reference (`docs/references/inductive-study-step-6.md`), including the archaic
 * KJV forms it lists. A word is a pronoun IFF its lower-cased, single-token form is a member of
 * this set.
 *
 * This set stores single lower-cased tokens ONLY. Multi-word forms ("no one", "each other",
 * "one another") are deliberately excluded: the matcher is single-token, so a multi-word string
 * could never match and storing one would be dead data. Numerals-as-quantifiers ("three", etc.)
 * are also excluded to limit noise. Both exclusions are documented limitations of this increment.
 *
 * Grouped by the reference's categories so the provenance is clear; overlap between categories
 * (e.g. "his", "her", "its" appear as both personal and possessive adjectives) is harmless in a
 * set. Mirrors the plain-constant style of `bible-books.ts`.
 */
export const PRONOUN_DICTIONARY: ReadonlySet<string> = new Set<string>([
  // Personal (nominative / objective / possessive)
  'i',
  'me',
  'mine',
  'you',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'it',
  'its',
  'we',
  'us',
  'our',
  'ours',
  'they',
  'them',
  'their',
  'theirs',

  // Possessive adjectives (overlap with the above is harmless in a set)
  'my',
  'your',

  // Archaic KJV forms
  'thou',
  'thee',
  'thine',
  'thy',
  'ye',

  // Demonstrative
  'this',
  'that',
  'these',
  'those',

  // Indefinite (single-token; multi-word "no one" is deliberately excluded)
  'all',
  'another',
  'any',
  'anybody',
  'anyone',
  'anything',
  'each',
  'everybody',
  'everyone',
  'everything',
  'few',
  'many',
  'most',
  'neither',
  'nobody',
  'none',
  'nothing',
  'one',
  'several',
  'some',
  'somebody',
  'someone',
  'something',

  // Intensive / reflexive
  'myself',
  'yourself',
  'himself',
  'herself',
  'itself',
  'ourselves',
  'yourselves',
  'themselves',

  // Interrogative / relative
  'who',
  'whom',
  'whose',
  'which',
  'what',
  'whoever',
  'whomever',
  'whichever',
  'whosever',
  'whatever',

  // Quantifier (numerals deliberately excluded)
  'both',
  'much',
  'little',
  'half',
]);
