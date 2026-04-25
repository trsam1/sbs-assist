/** Shared data models for the Bible Word Study Tool frontend. */

/** A single cross-reference verse location with user observations. */
export interface CrossReference {
  /** Verse location, e.g. "Romans 5:8" — no copyrighted text. */
  reference: string;
  /** User's observations after looking up this verse in their own Bible. */
  notes: string;
}

/** All data captured for a single word study entry. */
export interface WordStudyEntry {
  word: string;
  strongsNumber: string;
  englishDefinition: string;
  strongsDefinition: string;
  originalWord: string;
  transliteration: string;
  lexiconEntry: string;
  crossReferences: CrossReference[];
  aiSummary: string;
  notes: string;
}

/** The full study worksheet persisted per user. */
export interface StudyWorksheet {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  wordStudies: WordStudyEntry[];
  status: 'in_progress' | 'completed';
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
