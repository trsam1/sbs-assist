import type { OutlineNode } from './models';

/** The computed standard-form label for a node, e.g. "I", "A", "1", "a". */
export interface OutlineLabel {
  /** Position in the flat `nodes` array. */
  index: number;
  /** The node's nesting level (0 = top). */
  level: number;
  /** Roman/letter/arabic label per level, restarting under each new parent. */
  label: string;
}

/** Roman numerals I..M for 1..3999 (ample for any outline); pure, never throws. */
function toRoman(n: number): string {
  const table: readonly (readonly [number, string])[] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let remaining = n;
  let out = '';
  for (const [value, symbol] of table) {
    while (remaining >= value) {
      out += symbol;
      remaining -= value;
    }
  }
  return out;
}

/** Spreadsheet-style letters: 1→A, 26→Z, 27→AA. `upper` picks the case. */
function toLetters(n: number, upper: boolean): string {
  let remaining = n;
  let out = '';
  while (remaining > 0) {
    const rem = (remaining - 1) % 26;
    out = String.fromCharCode((upper ? 65 : 97) + rem) + out;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return out;
}

/** Format the 1-based sibling ordinal `ordinal` for a node at `level` (A4 cycle). */
function labelFor(level: number, ordinal: number): string {
  // 0 → Roman, 1 → UPPER letter, 2 → arabic, 3 → lower letter; deeper reuses the arabic/lower cycle.
  switch (((level % 4) + 4) % 4) {
    case 0:
      return toRoman(ordinal);
    case 1:
      return toLetters(ordinal, true);
    case 2:
      return String(ordinal);
    default:
      return toLetters(ordinal, false);
  }
}

/**
 * Compute standard outline-form labels (I / A / 1 / a) for an ordered node list.
 *
 * Pure: a function of the node order and levels only — it reads nothing else, persists nothing,
 * and never throws. The sibling counter at each level restarts whenever a node of a
 * shallower-or-equal level is seen (a new parent context), so the first level-1 node after a new
 * level-0 node is "A", not a continuation. Levels deeper than 3 reuse the arabic/lowercase cycle
 * (A4). `[]` → `[]`.
 */
export function outlineLabels(nodes: readonly OutlineNode[]): OutlineLabel[] {
  // counters[d] = how many level-d siblings have been emitted under the current parent at depth d.
  const counters: number[] = [];
  const out: OutlineLabel[] = [];

  nodes.forEach((node, index) => {
    const level = Number.isInteger(node.level) && node.level > 0 ? node.level : 0;

    // A node at `level` starts a fresh child context for every deeper level: reset them.
    counters.length = level + 1;
    counters[level] = (counters[level] ?? 0) + 1;

    out.push({ index, level, label: labelFor(level, counters[level]) });
  });

  return out;
}
