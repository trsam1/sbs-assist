/**
 * Server-side figure taxonomy: the id -> group map used to validate a Step 10 figure entry and to
 * recompute each entry's `group` from its `figureType` (the server never trusts a client-sent
 * group). This mirrors the client-owned taxonomy in `src/app/figures-taxonomy.ts`; a frontend test
 * asserts the two id sets agree so they cannot drift. 'other' is accepted but has no fixed group —
 * the caller supplies the group for 'other' (validated to the two allowed values).
 */
import type { FigureGroup } from './models';

/** Every fixed figure-type id mapped to its group. Parallelism (5 Lowth forms) + figures (~15). */
export const FIGURE_TYPE_GROUP: Readonly<Record<string, FigureGroup>> = {
  // Parallelism (Hebrew poetry; Lowth's categories)
  synonymous: 'parallelism',
  antithetic: 'parallelism',
  synthetic: 'parallelism',
  'statement-and-comment': 'parallelism',
  emblematic: 'parallelism',
  // Figures of speech
  allegory: 'figure',
  allusion: 'figure',
  apostrophe: 'figure',
  climax: 'figure',
  ellipsis: 'figure',
  euphemism: 'figure',
  hyperbole: 'figure',
  irony: 'figure',
  litotes: 'figure',
  metaphor: 'figure',
  metonymy: 'figure',
  parable: 'figure',
  personification: 'figure',
  anthropomorphism: 'figure',
  typology: 'figure',
};

/** The fixed ids (not including 'other'), for validation. */
export const FIGURE_TYPE_IDS: ReadonlySet<string> = new Set(Object.keys(FIGURE_TYPE_GROUP));

/** The two allowed group values. */
export const FIGURE_GROUPS: ReadonlySet<string> = new Set<FigureGroup>(['parallelism', 'figure']);
