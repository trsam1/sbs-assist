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

/** A user-owned container that organizes study work by a book of the Bible. */
export interface BookStudy {
  id: string; // server-generated UUID
  userId: string; // Cognito sub
  book: string; // one of the 66 canonical book names
  title: string; // optional display title; '' when unset
  notes: string; // optional free text; '' when unset
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  // Reserved for a later increment that links word studies; not populated yet.
  // wordStudyIds?: string[];
}

/** Create payload from the form (server sets id/userId/timestamps). */
export interface BookStudyInput {
  book: string;
  title?: string;
  notes?: string;
}

/** DynamoDB record shape for the BookStudies table. */
export interface BookStudyRecord {
  PK: string; // "USER#<userId>"
  SK: string; // "BOOKSTUDY#<bookStudyId>"
  bookStudyId: string;
  userId: string;
  book: string;
  title: string;
  notes: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  GSI1PK: string; // "USER#<userId>"
  GSI1SK: string; // "UPDATED#<updatedAt>" — sort by most recent
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
