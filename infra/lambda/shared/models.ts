/** Shared data models for the Bible Word Study Tool backend. */

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

/** DynamoDB record shape for the WordStudies table. */
export interface WordStudyRecord {
  PK: string;
  SK: string;
  studyId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  wordStudies: WordStudyEntry[];
  status: 'in_progress' | 'completed';
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
