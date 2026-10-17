import { describe, it, expect } from 'vitest';
import { outlineLabels } from './outline-number';
import type { OutlineNode } from './models';

function node(title: string, level: number): OutlineNode {
  return { title, level, startRef: '', endRef: '', notes: '' };
}

/** Convenience: just the label strings, in node order. */
function labelsOf(nodes: OutlineNode[]): string[] {
  return outlineLabels(nodes).map((l) => l.label);
}

describe('outlineLabels', () => {
  it('returns [] for an empty list', () => {
    expect(outlineLabels([])).toEqual([]);
  });

  it('numbers a flat top-level list with Roman numerals', () => {
    const nodes = [node('a', 0), node('b', 0), node('c', 0)];
    expect(labelsOf(nodes)).toEqual(['I', 'II', 'III']);
  });

  it('numbers nested levels as I / A / 1 / a', () => {
    const nodes = [node('I', 0), node('A', 1), node('1', 2), node('a', 3)];
    expect(labelsOf(nodes)).toEqual(['I', 'A', '1', 'a']);
  });

  it('restarts sibling numbering under each new parent', () => {
    const nodes = [
      node('I', 0),
      node('A', 1),
      node('B', 1),
      node('II', 0),
      node('A again', 1), // first child of the new parent → "A", not "C"
    ];
    expect(labelsOf(nodes)).toEqual(['I', 'A', 'B', 'II', 'A']);
  });

  it('restarts deeper counters when a shallower node appears', () => {
    const nodes = [
      node('I', 0),
      node('A', 1),
      node('1', 2),
      node('2', 2),
      node('B', 1), // level-1 resets the level-2 counter
      node('1 again', 2), // → "1", not "3"
    ];
    expect(labelsOf(nodes)).toEqual(['I', 'A', '1', '2', 'B', '1']);
  });

  it('reuses the arabic/lowercase cycle for levels deeper than 3', () => {
    const nodes = [
      node('I', 0),
      node('A', 1),
      node('1', 2),
      node('a', 3),
      node('level4', 4), // 4 % 4 === 0 → Roman again
      node('level5', 5), // 5 % 4 === 1 → upper letter
    ];
    expect(labelsOf(nodes)).toEqual(['I', 'A', '1', 'a', 'I', 'A']);
  });

  it('rolls Roman numerals past single symbols (IV, IX)', () => {
    const nodes = Array.from({ length: 9 }, () => node('x', 0));
    expect(labelsOf(nodes)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']);
  });

  it('rolls letters past Z to AA', () => {
    const nodes: OutlineNode[] = [node('parent', 0)];
    for (let i = 0; i < 27; i++) nodes.push(node('child', 1));
    const labels = labelsOf(nodes);
    expect(labels[1]).toBe('A');
    expect(labels[26]).toBe('Z');
    expect(labels[27]).toBe('AA');
  });

  it('carries index and level through on each label', () => {
    const nodes = [node('I', 0), node('A', 1)];
    expect(outlineLabels(nodes)).toEqual([
      { index: 0, level: 0, label: 'I' },
      { index: 1, level: 1, label: 'A' },
    ]);
  });

  it('treats a negative or non-integer level as 0', () => {
    const nodes = [
      { title: 'x', level: -1, startRef: '', endRef: '', notes: '' },
      { title: 'y', level: 1.5, startRef: '', endRef: '', notes: '' },
    ];
    expect(labelsOf(nodes)).toEqual(['I', 'II']);
  });
});
