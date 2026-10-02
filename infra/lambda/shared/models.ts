/** Shared data models for the Bible Word Study Tool backend. */

/** A single cross-reference verse location with user observations. */
export interface CrossReference {
  /** Verse location, e.g. "Romans 5:8" — no copyrighted text. */
  reference: string;
  /** User's observations after looking up this verse in their own Bible. */
  notes: string;
}

/** A single definition within an English meaning group. */
export interface EnglishDefinitionEntry {
  definition: string;
  example?: string;
}

/** A group of definitions for a specific part of speech. */
export interface EnglishMeaning {
  partOfSpeech: string;
  definitions: EnglishDefinitionEntry[];
}

/** Structured English dictionary result stored with a word study. */
export interface EnglishDefinitionData {
  word: string;
  phonetic?: string;
  meanings: EnglishMeaning[];
}

/** Legacy shape: items saved before 2026-04-27 store the English definition as a plain string. */
export type LegacyEnglishDefinition = string;

/** All data captured for a single word study entry. */
export interface WordStudyEntry {
  word: string;
  strongsNumber: string;
  /**
   * Structured definition, or a plain string for items saved before 2026-04-27
   * (read tolerantly; re-saving a study writes the object shape).
   */
  englishDefinition: EnglishDefinitionData | LegacyEnglishDefinition | null;
  strongsDefinition: string;
  originalWord: string;
  transliteration: string;
  lexiconEntry: string;
  crossReferences: CrossReference[];
  aiSummary: string;
  notes: string;
  /** Per-step notes: English Definition observations. */
  definitionNotes: string;
  /** Per-step notes: Strong's Concordance observations. */
  strongsNotes: string;
  /** Per-step notes: Lexicon Entry observations. */
  lexiconNotes: string;
}

/** The full study worksheet persisted per user. */
export interface StudyWorksheet {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  wordStudies: WordStudyEntry[];
}

/** DynamoDB record shape for the WordStudies table. */
export interface WordStudyRecord {
  PK: string;
  SK: string;
  studyId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  wordStudies: WordStudyEntry[];
  GSI1PK: string;
  GSI1SK: string;
}

/** DynamoDB record shape for the StrongsData table. */
export interface StrongsRecord {
  PK: string;
  SK: string;
  definition?: string;
  originalWord?: string;
  transliteration?: string;
  lexiconEntry?: string;
  reference?: string;
}
