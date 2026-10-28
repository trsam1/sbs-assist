/**
 * Client-owned constants for Step 12 — Interrogate the Text. Single source of truth for the
 * category picker, the suggested-tag datalist, and tag normalization. The server keeps its own
 * copy of the category set (the two cannot share a module across the app/infra boundary); a test
 * asserts the component renders the category options from this constant.
 */

/** The fixed question-kind categories (the 5 Ws + H, plus Other). Exactly one per entry. */
export const INTERROGATION_CATEGORIES = [
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'other',
] as const;

export type InterrogationCategory = (typeof INTERROGATION_CATEGORIES)[number];

/**
 * Suggested subject tags, offered as autocomplete only — the student may type any tag. This is NOT
 * a closed set and carries NO pre-written questions (no canned or AI question content anywhere in
 * this tool). The tags axis is what the student filters/surfaces on.
 */
export const SUGGESTED_TAGS: readonly string[] = [
  'about-God',
  'about-people',
  'command',
  'promise',
  'warning',
  'context',
  'cross-reference',
];

/** Max length of a single normalized tag. Mirrors the server cap. */
export const TAG_MAX = 40;
/** Max number of tags per entry. Mirrors the server cap. */
export const TAGS_PER_ENTRY_MAX = 20;

/**
 * Normalize a list of tags for storage/filtering: trim, lower-case, drop empties, de-duplicate
 * (order preserved). The client mirrors the server normalization for UX; the server is
 * authoritative. Over-long tags and the per-entry cap are enforced by the server (and surfaced as
 * a save error); this helper only canonicalizes spelling/casing/order.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
