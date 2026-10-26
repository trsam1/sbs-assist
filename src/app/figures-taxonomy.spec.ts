import { describe, it, expect } from 'vitest';
import { FIGURE_TYPES, FIGURE_TYPE_IDS, groupForType, nameForType } from './figures-taxonomy';
import { FIGURE_GLOSSARY } from './figures-glossary';
import { FIGURE_TYPE_GROUP } from '../../infra/lambda/shared/figure-types';

describe('figures taxonomy', () => {
  it('covers the 5 parallelism forms', () => {
    const parallelism = FIGURE_TYPES.filter((t) => t.group === 'parallelism').map((t) => t.id);
    expect(parallelism.sort()).toEqual(
      ['antithetic', 'emblematic', 'statement-and-comment', 'synonymous', 'synthetic'].sort(),
    );
  });

  it('includes the core figures of speech', () => {
    const figures = new Set(FIGURE_TYPES.filter((t) => t.group === 'figure').map((t) => t.id));
    for (const id of [
      'allegory',
      'apostrophe',
      'hyperbole',
      'irony',
      'litotes',
      'metaphor',
      'metonymy',
      'personification',
      'anthropomorphism',
      'typology',
    ]) {
      expect(figures.has(id), id).toBe(true);
    }
  });

  it('has unique ids and a group on every type', () => {
    const ids = FIGURE_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of FIGURE_TYPES) {
      expect(['parallelism', 'figure']).toContain(t.group);
    }
  });

  it('FIGURE_TYPE_IDS matches FIGURE_TYPES', () => {
    expect([...FIGURE_TYPE_IDS].sort()).toEqual(FIGURE_TYPES.map((t) => t.id).sort());
  });

  it('groupForType / nameForType resolve known ids and fall back sanely', () => {
    expect(groupForType('metaphor')).toBe('figure');
    expect(groupForType('antithetic')).toBe('parallelism');
    expect(groupForType('other')).toBeUndefined();
    expect(nameForType('metaphor')).toBe('Metaphor');
    expect(nameForType('unknown-id')).toBe('unknown-id');
  });

  it('agrees with the backend FIGURE_TYPE_GROUP (client/server cannot drift)', () => {
    // same id set
    expect([...FIGURE_TYPE_IDS].sort()).toEqual(Object.keys(FIGURE_TYPE_GROUP).sort());
    // same group per id
    for (const t of FIGURE_TYPES) {
      expect(FIGURE_TYPE_GROUP[t.id], t.id).toBe(t.group);
    }
  });
});

describe('figures glossary', () => {
  it('has one entry for every taxonomy id', () => {
    for (const t of FIGURE_TYPES) {
      expect(typeof FIGURE_GLOSSARY[t.id], t.id).toBe('string');
      expect(FIGURE_GLOSSARY[t.id].length, t.id).toBeGreaterThan(10);
    }
    // no stray glossary keys beyond the taxonomy
    expect(Object.keys(FIGURE_GLOSSARY).sort()).toEqual(FIGURE_TYPES.map((t) => t.id).sort());
  });

  it('carries no scripture-quotation markers (definitions only)', () => {
    // Crude guard: a book:chapter:verse reference immediately followed by a quote mark would
    // signal an embedded verse. Generic examples use no such reference.
    const verseQuote = /\b\d+:\d+\b\s*["“]/;
    for (const [id, text] of Object.entries(FIGURE_GLOSSARY)) {
      expect(verseQuote.test(text), `${id} must not embed a quoted verse`).toBe(false);
    }
  });
});
