/**
 * The fixed, client-owned Step 10 taxonomy: the single source of truth for the figure-type picker,
 * the glossary keys, and the server-validation id set (a test asserts this matches the backend
 * `FIGURE_TYPE_GROUP`). Grouped into `parallelism` (the 5 Lowth forms) and `figure` (the figures of
 * speech) so a later optional split of the two is a filter over the same records, not a migration.
 */
export type FigureGroup = 'parallelism' | 'figure';

export interface FigureType {
  id: string; // stable id, e.g. 'metaphor', 'antithetic'
  name: string; // display name, e.g. 'Metaphor', 'Antithetic parallelism'
  group: FigureGroup;
}

export const FIGURE_TYPES: readonly FigureType[] = [
  // Parallelism (Hebrew poetry; Lowth's categories)
  { id: 'synonymous', name: 'Synonymous parallelism', group: 'parallelism' },
  { id: 'antithetic', name: 'Antithetic parallelism', group: 'parallelism' },
  { id: 'synthetic', name: 'Synthetic parallelism', group: 'parallelism' },
  { id: 'statement-and-comment', name: 'Statement-and-comment parallelism', group: 'parallelism' },
  { id: 'emblematic', name: 'Emblematic parallelism', group: 'parallelism' },
  // Figures of speech
  { id: 'allegory', name: 'Allegory', group: 'figure' },
  { id: 'allusion', name: 'Allusion', group: 'figure' },
  { id: 'apostrophe', name: 'Apostrophe', group: 'figure' },
  { id: 'climax', name: 'Climax', group: 'figure' },
  { id: 'ellipsis', name: 'Ellipsis', group: 'figure' },
  { id: 'euphemism', name: 'Euphemism', group: 'figure' },
  { id: 'hyperbole', name: 'Hyperbole', group: 'figure' },
  { id: 'irony', name: 'Irony / sarcasm', group: 'figure' },
  { id: 'litotes', name: 'Litotes', group: 'figure' },
  { id: 'metaphor', name: 'Metaphor', group: 'figure' },
  { id: 'metonymy', name: 'Metonymy', group: 'figure' },
  { id: 'parable', name: 'Parable', group: 'figure' },
  { id: 'personification', name: 'Personification', group: 'figure' },
  { id: 'anthropomorphism', name: 'Anthropomorphism', group: 'figure' },
  { id: 'typology', name: 'Typology', group: 'figure' },
];

/** The fixed ids (not including 'other'), for lookups and server-sync tests. */
export const FIGURE_TYPE_IDS: ReadonlySet<string> = new Set(FIGURE_TYPES.map((t) => t.id));

/** Map an id to its group; returns undefined for 'other' / unknown ids. */
export function groupForType(id: string): FigureGroup | undefined {
  return FIGURE_TYPES.find((t) => t.id === id)?.group;
}

/** Display name for an id, falling back to the id itself. */
export function nameForType(id: string): string {
  return FIGURE_TYPES.find((t) => t.id === id)?.name ?? id;
}
