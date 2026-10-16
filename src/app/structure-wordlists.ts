/**
 * Fixed, client-owned word lists for the Step 7 Structure Study tool (Analyze the Structure of the
 * Book). Both are plain constants — the single source of truth imported by the analyzer and its
 * tests — mirroring the plain-constant style of `bible-books.ts` and `pronoun-dictionary.ts`.
 *
 * The forms are English, drawn from the Step 7 reference (`docs/references/inductive-study-step-7.md`).
 * Neither list is a grammatical parser nor a Bible concordance: `STOP_WORDS` is a relevance filter
 * for the repeated-word frequency view, and `SIGNAL_PHRASES` is advisory seed data for marker
 * candidates — an un-accepted candidate is never persisted.
 */

/**
 * Common English function words removed from the frequency view by default, so the surfaced "focus
 * words" are content words rather than articles, prepositions, conjunctions, and auxiliaries. Lower
 * cased, single tokens only (matching the analyzer's letter-run tokeniser).
 */
export const STOP_WORDS: ReadonlySet<string> = new Set<string>([
  // Articles / determiners
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'each',
  'every',
  'any',
  'all',
  'some',
  'no',
  'such',
  // Conjunctions
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
  'for',
  'as',
  'if',
  'than',
  'then',
  'because',
  'while',
  'both',
  // Prepositions
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'from',
  'with',
  'about',
  'into',
  'over',
  'under',
  'through',
  'between',
  'among',
  'against',
  'upon',
  'unto',
  'out',
  'up',
  'down',
  'off',
  'above',
  'below',
  // Pronouns / possessives (counted elsewhere by the Step 6 tool; noise here)
  'i',
  'me',
  'my',
  'mine',
  'we',
  'us',
  'our',
  'ours',
  'you',
  'your',
  'yours',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'it',
  'its',
  'they',
  'them',
  'their',
  'theirs',
  'who',
  'whom',
  'whose',
  'which',
  'what',
  'thou',
  'thee',
  'thy',
  'thine',
  'ye',
  // Auxiliaries / common verbs of being
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'shall',
  'will',
  'would',
  'should',
  'may',
  'might',
  'must',
  'can',
  'could',
  'not',
  // High-frequency adverbs / fillers
  'there',
  'here',
  'now',
  'when',
  'where',
  'how',
  'why',
  'also',
  'very',
  'too',
  'only',
  'even',
  'just',
  'again',
]);

/** The marker kind a signal phrase suggests. Mirrors `StructureMarker.kind`. */
export type MarkerKind = 'transition' | 'direct-address' | 'declarative' | 'command' | 'other';

/** A single advisory signal phrase and the marker kind it suggests. */
export interface SignalPhrase {
  /** The phrase to look for, lower-cased. Matched case-insensitively against the scroll text. */
  phrase: string;
  /** The marker kind this phrase suggests. */
  kind: MarkerKind;
}

/**
 * Advisory signal phrases drawn from the Step 7 reference's structural signals (transitional
 * statements, direct address, strong declaratives/commands). Matches are CANDIDATES only: the
 * student decides which are real structural markers and may add their own. The list is a plain
 * constant and is trivially extended; recall gaps across translations are an accepted limitation.
 */
export const SIGNAL_PHRASES: readonly SignalPhrase[] = [
  // Transitional statements — mark the seams of the author's thought.
  { phrase: 'now concerning', kind: 'transition' },
  { phrase: 'concerning', kind: 'transition' },
  { phrase: 'finally', kind: 'transition' },
  { phrase: 'therefore', kind: 'transition' },
  { phrase: 'but now', kind: 'transition' },
  { phrase: 'after these things', kind: 'transition' },
  { phrase: 'after this', kind: 'transition' },
  { phrase: 'in those days', kind: 'transition' },
  { phrase: 'moreover', kind: 'transition' },
  { phrase: 'furthermore', kind: 'transition' },
  { phrase: 'meanwhile', kind: 'transition' },
  { phrase: 'nevertheless', kind: 'transition' },

  // Direct address — the vocative is a reliable marker of a seam.
  { phrase: 'my brethren', kind: 'direct-address' },
  { phrase: 'brethren', kind: 'direct-address' },
  { phrase: 'beloved', kind: 'direct-address' },
  { phrase: 'dear friends', kind: 'direct-address' },
  { phrase: 'my children', kind: 'direct-address' },
  { phrase: 'little children', kind: 'direct-address' },
  { phrase: 'o lord', kind: 'direct-address' },

  // Strong declaratives — forceful summaries that sit at structural hinges.
  { phrase: 'verily, verily', kind: 'declarative' },
  { phrase: 'verily verily', kind: 'declarative' },
  { phrase: 'truly, truly', kind: 'declarative' },
  { phrase: 'i am not ashamed', kind: 'declarative' },
  { phrase: 'this is', kind: 'declarative' },

  // Commands — imperatives marking covenant demand or application.
  { phrase: 'thou shalt', kind: 'command' },
  { phrase: 'you shall', kind: 'command' },
  { phrase: 'do not', kind: 'command' },
  { phrase: 'let us', kind: 'command' },
  { phrase: 'behold', kind: 'command' },
  { phrase: 'remember', kind: 'command' },
];
