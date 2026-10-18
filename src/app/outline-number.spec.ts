import { describe, it, expect } from 'vitest';
import { outlineLabels } from './outline-number';
import type { OutlineGrouping, OutlineParagraph } from './models';

function para(mainIdea: string): OutlineParagraph {
  return { startRef: '', endRef: '', mainIdea, notes: '' };
}

function grouping(
  column: number,
  startIndex: number,
  endIndex: number,
  title = 't',
): OutlineGrouping {
  return { column, startIndex, endIndex, title, notes: '' };
}

/** Convenience: just the label strings, in emission order. */
function labelsOf(paragraphs: OutlineParagraph[], groupings: OutlineGrouping[]): string[] {
  return outlineLabels(paragraphs, groupings).map((l) => l.label);
}

describe('outlineLabels', () => {
  it('returns [] for an empty paragraph list', () => {
    expect(outlineLabels([], [])).toEqual([]);
    expect(outlineLabels([], [grouping(1, 0, 0)])).toEqual([]);
  });

  it('numbers a flat paragraph list (no groupings) with Roman numerals', () => {
    const paras = [para('a'), para('b'), para('c')];
    expect(labelsOf(paras, [])).toEqual(['I', 'II', 'III']);
  });

  it('emits paragraph rows at the top level when there are no groupings', () => {
    const paras = [para('a'), para('b')];
    expect(outlineLabels(paras, [])).toEqual([
      { kind: 'paragraph', ref: 0, level: 0, label: 'I' },
      { kind: 'paragraph', ref: 1, level: 0, label: 'II' },
    ]);
  });

  it('one bracket column: bracket is I, its paragraphs are A/B underneath', () => {
    // 3 paragraphs, one bracket covering paras 0..1; para 2 uncovered.
    const paras = [para('p0'), para('p1'), para('p2')];
    const groupings = [grouping(1, 0, 1, 'Bracket')];
    const result = outlineLabels(paras, groupings);
    // Top level: the bracket (I) and the uncovered paragraph 2 (II).
    expect(result.map((r) => `${r.kind}:${r.ref}:${r.label}:${r.level}`)).toEqual([
      'grouping:0:I:0',
      'paragraph:0:A:1',
      'paragraph:1:B:1',
      'paragraph:2:II:0',
    ]);
  });

  it('two columns: division I, bracket A, paragraphs 1/2 — I/A/1', () => {
    // 2 paragraphs; column-1 bracket over 0..1; column-2 division over 0..1.
    const paras = [para('p0'), para('p1')];
    const groupings = [grouping(1, 0, 1, 'Bracket'), grouping(2, 0, 1, 'Division')];
    const result = outlineLabels(paras, groupings);
    expect(result.map((r) => `${r.kind}:${r.ref}:${r.label}:${r.level}`)).toEqual([
      'grouping:1:I:0', // column-2 division is the top level
      'grouping:0:A:1', // column-1 bracket under it
      'paragraph:0:1:2', // paragraphs at level 2 → arabic
      'paragraph:1:2:2',
    ]);
  });

  it('restarts sibling numbering under each new parent', () => {
    // 4 paragraphs; two column-1 brackets: [0,1] and [2,3].
    const paras = [para('p0'), para('p1'), para('p2'), para('p3')];
    const groupings = [grouping(1, 0, 1, 'B1'), grouping(1, 2, 3, 'B2')];
    // Top level: bracket B1 (I) with A/B, bracket B2 (II) with A/B again.
    expect(labelsOf(paras, groupings)).toEqual(['I', 'A', 'B', 'II', 'A', 'B']);
  });

  it('orders brackets by their start index regardless of array order', () => {
    const paras = [para('p0'), para('p1'), para('p2'), para('p3')];
    // Later span listed first in the array.
    const groupings = [grouping(1, 2, 3, 'second'), grouping(1, 0, 1, 'first')];
    const result = outlineLabels(paras, groupings);
    const brackets = result.filter((r) => r.kind === 'grouping');
    // First-by-start-index gets "I".
    expect(brackets).toEqual([
      { kind: 'grouping', ref: 1, level: 0, label: 'I' },
      { kind: 'grouping', ref: 0, level: 0, label: 'II' },
    ]);
  });

  it('mixes a covered bracket and an uncovered paragraph at the top level in reading order', () => {
    const paras = [para('p0'), para('p1'), para('p2')];
    // Bracket over 1..2; paragraph 0 uncovered and comes first.
    const groupings = [grouping(1, 1, 2, 'late bracket')];
    const result = outlineLabels(paras, groupings);
    expect(result.map((r) => `${r.kind}:${r.ref}:${r.label}`)).toEqual([
      'paragraph:0:I', // uncovered para 0 first
      'grouping:0:II', // then the bracket
      'paragraph:1:A',
      'paragraph:2:B',
    ]);
  });

  it('ignores a grouping with an out-of-range or inverted span', () => {
    const paras = [para('p0'), para('p1')];
    const bad = [
      grouping(1, 0, 5, 'too wide'),
      grouping(1, 1, 0, 'inverted'),
      grouping(0, 0, 1, 'column 0'),
    ];
    // All invalid → treated as a flat list.
    expect(labelsOf(paras, bad)).toEqual(['I', 'II']);
  });

  it('rolls Roman numerals past single symbols for a long flat list', () => {
    const paras = Array.from({ length: 9 }, (_, i) => para(`p${i}`));
    expect(labelsOf(paras, [])).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']);
  });

  it('rolls letters past Z to AA under a single parent', () => {
    const paras = Array.from({ length: 27 }, (_, i) => para(`p${i}`));
    const groupings = [grouping(1, 0, 26, 'big bracket')];
    const labels = outlineLabels(paras, groupings).filter((r) => r.kind === 'paragraph');
    expect(labels[0].label).toBe('A');
    expect(labels[25].label).toBe('Z');
    expect(labels[26].label).toBe('AA');
  });

  it('three columns cycle I / A / 1 / a with paragraphs at the leaf', () => {
    // 2 paragraphs under col1 bracket, under col2, under col3 → depths 0,1,2 then paras at 3.
    const paras = [para('p0'), para('p1')];
    const groupings = [grouping(1, 0, 1), grouping(2, 0, 1), grouping(3, 0, 1)];
    // I (col3) / A (col2) / 1 (col1) / then the two paragraphs at level 3 → lowercase a, b
    expect(labelsOf(paras, groupings)).toEqual(['I', 'A', '1', 'a', 'b']);
  });
});
