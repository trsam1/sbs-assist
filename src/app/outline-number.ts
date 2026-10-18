import type { OutlineGrouping, OutlineParagraph } from './models';

/** The computed standard-form label for one outline row (a grouping or a paragraph). */
export interface OutlineLabel {
  /** Which collection `ref` indexes. */
  kind: 'grouping' | 'paragraph';
  /** Index into `groupings[]` (kind='grouping') or `paragraphs[]` (kind='paragraph'). */
  ref: number;
  /** Nesting level: 0 = top division ("I"), increasing toward the paragraph leaf. */
  level: number;
  /** Roman/letter/arabic label for this row, restarting under each new parent. */
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

/** Format the 1-based sibling ordinal `ordinal` for a node at `level` (I / A / 1 / a cycle). */
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

/** A grouping with its original array index, used while sorting by span. */
interface IndexedGrouping extends OutlineGrouping {
  ref: number;
}

/**
 * Emit the standard-form labels for everything a given parent span covers, at `level`.
 *
 * `level` numbers from the top division down. The children at this level are the groupings in
 * `targetColumn` whose span lies within `[spanStart, spanEnd]`; any paragraph in that range not
 * covered by such a grouping is itself a child at this level. Children are emitted left-to-right by
 * their start index, each with a restarting sibling counter, and each grouping recurses into the
 * next column down (`targetColumn - 1`), bottoming out at the paragraphs.
 */
function emit(
  groupingsByColumn: Map<number, IndexedGrouping[]>,
  paragraphCount: number,
  level: number,
  targetColumn: number,
  spanStart: number,
  spanEnd: number,
  out: OutlineLabel[],
): void {
  // Children of this parent: column-`targetColumn` groupings inside the span, plus any paragraph
  // in the span not covered by one of them — all ordered by start index.
  type Child =
    | { kind: 'grouping'; ref: number; start: number; end: number; column: number }
    | { kind: 'paragraph'; ref: number; start: number; end: number };

  const children: Child[] = [];
  const covered = new Array<boolean>(paragraphCount).fill(false);

  if (targetColumn >= 1) {
    const inColumn = groupingsByColumn.get(targetColumn) ?? [];
    for (const g of inColumn) {
      if (g.startIndex >= spanStart && g.endIndex <= spanEnd) {
        children.push({
          kind: 'grouping',
          ref: g.ref,
          start: g.startIndex,
          end: g.endIndex,
          column: targetColumn,
        });
        for (let i = g.startIndex; i <= g.endIndex; i++) covered[i] = true;
      }
    }
  }
  // Uncovered paragraphs in the span become children at this level too.
  for (let i = spanStart; i <= spanEnd; i++) {
    if (!covered[i]) {
      children.push({ kind: 'paragraph', ref: i, start: i, end: i });
    }
  }

  children.sort((a, b) => a.start - b.start);

  let ordinal = 0;
  for (const child of children) {
    ordinal += 1;
    const label = labelFor(level, ordinal);
    if (child.kind === 'grouping') {
      out.push({ kind: 'grouping', ref: child.ref, level, label });
      // Recurse into the next column down for this grouping's span.
      emit(
        groupingsByColumn,
        paragraphCount,
        level + 1,
        child.column - 1,
        child.start,
        child.end,
        out,
      );
    } else {
      out.push({ kind: 'paragraph', ref: child.ref, level, label });
    }
  }
}

/**
 * Compute standard outline-form labels (I / A / 1 / a) for a paragraphs + groupings structure.
 *
 * Pure: a function of the paragraphs and the column groupings only — it reads nothing else,
 * persists nothing, and never throws. The outermost division is the highest grouping column; each
 * lower column is a deeper level, with paragraphs as the leaves. A paragraph covered by no grouping
 * is numbered at the top level, so an outline with no groupings renders a flat I / II / III list.
 * Sibling counters restart under each new parent. Spans are assumed contiguous and in range (the
 * caller and the server both guarantee this). `([], …)` → `[]`.
 */
export function outlineLabels(
  paragraphs: readonly OutlineParagraph[],
  groupings: readonly OutlineGrouping[],
): OutlineLabel[] {
  const paragraphCount = paragraphs.length;
  if (paragraphCount === 0) {
    return [];
  }

  // Bucket groupings by column; ignore any with an out-of-range or inverted span defensively.
  const byColumn = new Map<number, IndexedGrouping[]>();
  let maxColumn = 0;
  groupings.forEach((g, ref) => {
    const column = Number.isInteger(g.column) ? g.column : 0;
    if (column < 1) return;
    if (
      !Number.isInteger(g.startIndex) ||
      !Number.isInteger(g.endIndex) ||
      g.startIndex < 0 ||
      g.endIndex >= paragraphCount ||
      g.startIndex > g.endIndex
    ) {
      return;
    }
    const list = byColumn.get(column) ?? [];
    list.push({ ...g, ref });
    byColumn.set(column, list);
    if (column > maxColumn) maxColumn = column;
  });

  const out: OutlineLabel[] = [];
  // The whole book is the root span [0, count-1]; start at the highest column (top division).
  emit(byColumn, paragraphCount, 0, maxColumn, 0, paragraphCount - 1, out);
  return out;
}
