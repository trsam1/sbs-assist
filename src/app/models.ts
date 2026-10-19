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

/** One pronoun occurrence's assigned antecedent (Step 6 — Define Antecedents). */
export interface AntecedentAssignment {
  occurrence: number; // 0-based ordinal of the pronoun appearance in the scroll text (the key)
  start: number; // 0-based character offset of the occurrence in the scroll text (context/migration)
  word: string; // canonical lower-cased pronoun form (for display; not the key)
  antecedent: string; // trimmed, 0–200 chars ('' allowed when only a type is set)
  pronounType?: string; // '' or one of PRONOUN_TYPES; optional/additive; legacy records omit it
}

/** A persisted set of antecedent assignments for one scroll study, owned by the current user. */
export interface AntecedentStudy {
  scrollStudyId: string;
  userId: string; // Cognito sub
  assignments: AntecedentAssignment[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** One structural marker the student recorded in Step 7 (Analyze the Structure of the Book). */
export interface StructureMarker {
  kind: 'transition' | 'direct-address' | 'declarative' | 'command' | 'other';
  phrase: string; // required
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

/** The persisted Step 7 worksheet for one scroll study, owned by the current user. */
export interface StructureStudy {
  scrollStudyId: string;
  userId: string; // Cognito sub
  genre: string; // '' when unset
  tone: string; // '' when unset
  markers: StructureMarker[];
  sections: StructureSection[]; // ordered; feeds Step 8 (Provisional Outline)
  elements: StructureElement[]; // optional elements chart; [] when unset
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Save payload from the structure view (server sets userId/timestamps). */
export interface StructureStudyInput {
  genre?: string;
  tone?: string;
  markers?: StructureMarker[];
  sections?: StructureSection[];
  elements?: StructureElement[];
}

/**
 * One paragraph of the book — the atomic row of the Step 8 outline (the leftmost column).
 * Paragraphs are stored in reading order; a grouping references them by index.
 */
export interface OutlineParagraph {
  startRef: string; // optional free text, '' when unset (<=50)
  endRef: string; // optional free text, '' when unset (<=50)
  mainIdea: string; // required free text — the single-statement main idea / working title (<=200)
  notes: string; // free text, '' when unset (<=1000)
}

/**
 * A grouping: a contiguous span of paragraphs merged and titled, at a given merge column.
 * `column` 1 is the first bracket column, 2 the next, and so on to the right. `startIndex`/
 * `endIndex` are inclusive indices into the ordered `paragraphs` array (always contiguous).
 */
export interface OutlineGrouping {
  column: number; // 1 = first bracket column, 2 = next, …; integer >= 1
  startIndex: number; // first paragraph covered (inclusive), integer >= 0
  endIndex: number; // last paragraph covered (inclusive); startIndex <= endIndex < paragraphs.length
  title: string; // required free text (<=200)
  notes: string; // free text, '' when unset (<=1000)
}

/** The persisted Step 8 worksheet for one scroll study, owned by the current user. */
export interface OutlineStudy {
  scrollStudyId: string;
  userId: string; // Cognito sub
  paragraphs: OutlineParagraph[]; // ordered, reading order; the leftmost column
  groupings: OutlineGrouping[]; // contiguous paragraph spans in columns to the right
  theme: string; // Step 9: what the book is about, short condensation; '' when unset (<=80)
  purpose: string; // Step 9: the author's goal, one sentence; '' when unset (<=500)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Save payload from the outline view (server sets userId/timestamps). */
export interface OutlineStudyInput {
  paragraphs?: OutlineParagraph[];
  groupings?: OutlineGrouping[];
  theme?: string; // Step 9; omitted/'' allowed
  purpose?: string; // Step 9; omitted/'' allowed
}
