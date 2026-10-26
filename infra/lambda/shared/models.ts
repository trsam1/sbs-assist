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

/** Status progression for a Scroll Study (Step 4 — Observe the Text as a Scroll). */
export type ScrollStatus = 'uploading' | 'extracting' | 'ready' | 'failed';

/**
 * Maximum number of bytes of extracted text stored inline on a Scroll Study record.
 * DynamoDB caps an item at 400 KB; 350,000 leaves headroom for the other attributes.
 */
export const SCROLL_TEXT_LIMIT = 350_000;

/** DynamoDB record shape for the ScrollStudies table. */
export interface ScrollStudyRecord {
  PK: string; // "USER#<sub>"
  SK: string; // "SCROLL#<scrollStudyId>"
  scrollStudyId: string;
  userId: string; // Cognito sub
  bookStudyId: string; // owning Book Study; '' on legacy orphans until backfilled
  bookName: string; // <=100 chars; set from the owning Book Study's `book`
  objectKey: string; // "uploads/<sub>/<scrollStudyId>.<ext>"
  status: ScrollStatus;
  scrollText: string; // '' until ready
  truncated: boolean;
  failureReason: string; // '' unless failed
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  GSI1PK: string; // "USER#<sub>"
  GSI1SK: string; // "UPDATED#<updatedAt>"
}

/** A documented referent found while working Step 6 (what a descriptive phrase stands for). */
export interface Referent {
  phrase: string; // descriptive phrase found (required, <=200)
  refersTo: string; // what it stands for (required, <=200)
  notes: string; // free text, '' when unset (<=1000)
  scrollRef: string; // optional free-text location, '' when unset (<=1000)
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
  referents: Referent[]; // documented referents (Step 6); [] on legacy records
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
  referents: Referent[]; // documented referents (Step 6); absent on legacy records
  GSI1PK: string; // "USER#<userId>"
  GSI1SK: string; // "UPDATED#<updatedAt>" — sort by most recent
}

/** One pronoun occurrence's assigned antecedent (Step 6 — Define Antecedents). */
export interface AntecedentAssignment {
  occurrence: number; // 0-based ordinal of the pronoun appearance in the scroll text (the key)
  start: number; // 0-based character offset of the occurrence in the scroll text (context/migration)
  word: string; // canonical lower-cased pronoun form (for display; not the key)
  antecedent: string; // trimmed, 0–200 chars ('' allowed when only a type is set)
  pronounType?: string; // '' or one of PRONOUN_TYPES; optional/additive; legacy records omit it
}

/** DynamoDB record shape for the AntecedentStudies table (one per scroll per user). */
export interface AntecedentStudyRecord {
  PK: string; // "USER#<sub>"
  SK: string; // "ANTECEDENT#<scrollStudyId>"
  scrollStudyId: string;
  userId: string; // Cognito sub
  assignments: AntecedentAssignment[]; // rows with a non-empty antecedent and/or a pronounType
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
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

/** One structural marker the student recorded in Step 7 (Analyze the Structure of the Book). */
export interface StructureMarker {
  kind: 'transition' | 'direct-address' | 'declarative' | 'command' | 'other';
  phrase: string; // required (<=200)
  ref: string; // optional free-text location, '' when unset (<=200)
  notes: string; // free text, '' when unset (<=1000)
}

/** One ordered section/division of the book the student drew in Step 7. */
export interface StructureSection {
  label: string; // required free text (<=200)
  startRef: string; // optional free text, '' when unset (<=50)
  endRef: string; // optional free text, '' when unset (<=50)
  notes: string; // free text, '' when unset (<=1000)
}

/** One row of the optional elements chart (an element and where it occurs). */
export interface StructureElement {
  element: string; // required free text (<=200)
  sectionRefs: string[]; // labels/positions of sections where it occurs; [] allowed
}

/** DynamoDB record shape for the StructureStudies table (one per scroll per user). */
export interface StructureStudyRecord {
  PK: string; // "USER#<sub>"
  SK: string; // "STRUCTURE#<scrollStudyId>"
  scrollStudyId: string;
  userId: string; // Cognito sub
  genre: string; // '' when unset
  tone: string; // '' when unset
  markers: StructureMarker[];
  sections: StructureSection[]; // ordered; feeds Step 8
  elements: StructureElement[]; // optional elements chart; [] when unset
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** One paragraph of the book — the atomic row of the Step 8 outline (the leftmost column). */
export interface OutlineParagraph {
  startRef: string; // optional free text, '' when unset (<=50)
  endRef: string; // optional free text, '' when unset (<=50)
  mainIdea: string; // required free text — the single-statement main idea / working title (<=200)
  notes: string; // free text, '' when unset (<=1000)
}

/** A grouping: a contiguous span of paragraphs merged and titled, at a given merge column. */
export interface OutlineGrouping {
  column: number; // 1 = first bracket column, 2 = next, …; integer >= 1
  startIndex: number; // first paragraph covered (inclusive), integer >= 0
  endIndex: number; // last paragraph covered (inclusive); startIndex <= endIndex < paragraphs.length
  title: string; // required free text (<=200)
  notes: string; // free text, '' when unset (<=1000)
}

/** DynamoDB record shape for the OutlineStudies table (one per scroll per user). */
export interface OutlineStudyRecord {
  PK: string; // "USER#<sub>"
  SK: string; // "OUTLINE#<scrollStudyId>"
  scrollStudyId: string;
  userId: string; // Cognito sub
  paragraphs: OutlineParagraph[]; // ordered, reading order; the leftmost column
  groupings: OutlineGrouping[]; // contiguous paragraph spans in columns to the right
  theme: string; // Step 9: what the book is about, short condensation; '' when unset (<=80)
  purpose: string; // Step 9: the author's goal, one sentence; '' when unset (<=500)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
