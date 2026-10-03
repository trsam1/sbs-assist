/** Shared data models for the Bible Word Study Tool frontend. */

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

/** All data captured for a single word study entry. */
export interface WordStudyEntry {
  word: string;
  strongsNumber: string;
  englishDefinition: EnglishDefinitionData | null;
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

/** Input shape emitted by the study input form. */
export interface StudyInput {
  word: string;
  strongsNumber: string;
}

/** Response shape from the Strong's lookup API. */
export interface StrongsStudyResult {
  strongsNumber: string;
  definition: string;
  originalWord: string;
  transliteration: string;
  lexiconEntry: string;
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
