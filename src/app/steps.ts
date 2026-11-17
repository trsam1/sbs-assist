/**
 * The single source for the inductive method's steps: numbers, names, routes and software fit.
 * Book home, the scroll page and the tool shell all read this; do not hard-code a step list elsewhere.
 */

export type FitTag = 'shipped' | 'planned' | 'candidate' | 'manual';

export interface StepDef {
  /** Stable id. For scroll-based tools it is also what `ToolShell` takes as `stepId`. */
  id: string;
  /** Step number in the method, or null for companion tools that are not a numbered step. */
  number: number | null;
  name: string;
  /** Route suffix under `/scroll/:scrollStudyId` ('' is the scroll page itself); null = no page. */
  route: string | null;
  /** Optional fragment (a section of the page the step lives in). */
  fragment?: string;
  fit: FitTag;
  blurb: string;
  /** True when the page reads the book's scroll text. */
  needsScroll: boolean;
  /** True when the step is a stop in the previous/next switcher (one stop per distinct page). */
  inSwitcher: boolean;
}

export const STEPS: readonly StepDef[] = [
  {
    id: 'pray',
    number: 1,
    name: 'Pray',
    route: null,
    fit: 'manual',
    blurb: 'Ask God to open your eyes to the text.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'read',
    number: 2,
    name: 'Read the Book',
    route: null,
    fit: 'manual',
    blurb: 'Read the whole book in your own Bible.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'background',
    number: 3,
    name: 'Research the Background',
    route: null,
    fit: 'candidate',
    blurb: 'Author, audience, date and setting.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'scroll',
    number: 4,
    name: 'Observe the Text as a Scroll',
    route: '',
    fit: 'shipped',
    blurb: 'Upload the book as running text.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'word-study',
    number: 5,
    name: 'Define Key Words',
    route: null,
    fit: 'shipped',
    blurb: 'Word studies live in their own list.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'pronouns',
    number: 6,
    name: 'Pronouns',
    route: 'pronouns',
    fit: 'shipped',
    blurb: 'Find the pronouns in the book.',
    needsScroll: true,
    inSwitcher: true,
  },
  {
    id: 'antecedents',
    number: 6,
    name: 'Antecedents',
    route: 'antecedents',
    fit: 'shipped',
    blurb: 'Say what each pronoun points back to.',
    needsScroll: true,
    inSwitcher: true,
  },
  {
    id: 'structure',
    number: 7,
    name: 'Structure of the Book',
    route: 'structure',
    fit: 'shipped',
    blurb: 'Repeated words, tone, genre and sections.',
    needsScroll: true,
    inSwitcher: true,
  },
  {
    id: 'outline',
    number: 8,
    name: 'Provisional Outline',
    route: 'outline',
    fit: 'shipped',
    blurb: 'An outline in I / A / 1 / a form.',
    needsScroll: true,
    inSwitcher: true,
  },
  {
    id: 'theme',
    number: 9,
    name: 'Theme and Purpose',
    route: 'outline',
    fragment: 'theme',
    fit: 'shipped',
    blurb: 'State the theme and purpose beside your outline.',
    needsScroll: true,
    inSwitcher: false,
  },
  {
    id: 'figures',
    number: 10,
    name: 'Figures of Speech',
    route: 'figures',
    fit: 'shipped',
    blurb: 'Tag figures and parallelism.',
    needsScroll: true,
    inSwitcher: true,
  },
  {
    id: 'genre',
    number: 11,
    name: 'Identify the Genre',
    route: null,
    fit: 'candidate',
    blurb: 'The dominant genre is recorded in Step 7.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'interrogate',
    number: 12,
    name: 'Interrogate the Text',
    route: 'interrogate',
    fit: 'shipped',
    blurb: 'Ask who, what, when, where, why and how.',
    needsScroll: true,
    inSwitcher: true,
  },
  {
    id: 'cross-refs',
    number: 13,
    name: 'Check Cross-References',
    route: null,
    fit: 'candidate',
    blurb: 'Record related passages (locations only).',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'paraphrase',
    number: 14,
    name: 'Write a Condensed Paraphrase',
    route: null,
    fit: 'candidate',
    blurb: 'Restate the outline in your own words.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'discuss',
    number: 15,
    name: 'Discuss the Text',
    route: null,
    fit: 'manual',
    blurb: 'Talk it through with a group.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'applications',
    number: 16,
    name: 'Draw Applications',
    route: null,
    fit: 'candidate',
    blurb: 'Commands, warnings, promises, examples, implications.',
    needsScroll: false,
    inSwitcher: false,
  },
  {
    id: 'obey',
    number: 17,
    name: "Obey God's Word",
    route: null,
    fit: 'manual',
    blurb: 'Do what it says.',
    needsScroll: false,
    inSwitcher: false,
  },
];

/** Tools that support the method without being a numbered step. */
export const COMPANION_TOOLS: readonly StepDef[] = [
  {
    id: 'memorize',
    number: null,
    name: 'Memorize the Scroll',
    route: 'memorize',
    fit: 'shipped',
    blurb: 'Learn, review and recite the text from memory.',
    needsScroll: true,
    inSwitcher: true,
  },
];

const ALL: readonly StepDef[] = [...STEPS, ...COMPANION_TOOLS];

export function stepById(id: string): StepDef | undefined {
  return ALL.find((s) => s.id === id);
}

/** The pages a student can move between, in method order, Memorize last. */
export function switcherSteps(): StepDef[] {
  return ALL.filter((s) => s.inSwitcher);
}

/** Previous and next switcher stops around a step id (null at either end or for an unknown id). */
export function neighbours(id: string): { prev: StepDef | null; next: StepDef | null } {
  const list = switcherSteps();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: i > 0 ? list[i - 1] : null, next: i < list.length - 1 ? list[i + 1] : null };
}

/** A step's heading text, e.g. "Step 6 — Pronouns" or "Memorize the Scroll". */
export function stepLabel(step: StepDef): string {
  return step.number === null ? step.name : `Step ${step.number} — ${step.name}`;
}

/** Router link commands for a scroll-based step. */
export function stepLink(step: StepDef, scrollStudyId: string): string[] {
  return step.route === ''
    ? ['/scroll', scrollStudyId]
    : ['/scroll', scrollStudyId, step.route ?? ''];
}
