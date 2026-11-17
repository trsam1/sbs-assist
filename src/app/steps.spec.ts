import { describe, it, expect } from 'vitest';
import { routes } from './app.routes';
import {
  COMPANION_TOOLS,
  STEPS,
  neighbours,
  stepById,
  stepLabel,
  stepLink,
  switcherSteps,
} from './steps';

describe('step catalog', () => {
  it('lists steps 1 to 17 in method order', () => {
    const numbers = STEPS.map((s) => s.number as number);
    const sorted = [...numbers].sort((a, b) => a - b);
    expect(numbers).toEqual(sorted);
    expect(new Set(numbers)).toEqual(new Set(Array.from({ length: 17 }, (_, i) => i + 1)));
  });

  it('has no duplicate ids', () => {
    const ids = [...STEPS, ...COMPANION_TOOLS].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps manual steps free of pages', () => {
    for (const s of STEPS.filter((x) => x.fit === 'manual')) {
      expect(s.route).toBeNull();
    }
  });

  it('only routes to pages that are registered in app.routes', () => {
    const paths = new Set(routes.map((r) => r.path));
    for (const s of [...STEPS, ...COMPANION_TOOLS]) {
      if (s.route === null) continue;
      const path = s.route === '' ? 'scroll/:scrollStudyId' : `scroll/:scrollStudyId/${s.route}`;
      expect(paths.has(path), `${s.id} -> ${path}`).toBe(true);
    }
  });

  it('puts Memorize in the companion list, not as a numbered step', () => {
    expect(STEPS.find((s) => s.id === 'memorize')).toBeUndefined();
    expect(stepById('memorize')?.number).toBeNull();
  });

  it('gives each switcher stop a distinct page', () => {
    const routesInSwitcher = switcherSteps().map((s) => s.route);
    expect(new Set(routesInSwitcher).size).toBe(routesInSwitcher.length);
  });
});

describe('neighbours', () => {
  it('has no previous at the start and no next at the end', () => {
    const list = switcherSteps();
    expect(neighbours(list[0].id).prev).toBeNull();
    expect(neighbours(list[list.length - 1].id).next).toBeNull();
  });

  it('links adjacent stops', () => {
    expect(neighbours('structure').prev?.id).toBe('antecedents');
    expect(neighbours('structure').next?.id).toBe('outline');
  });

  it('ends the method at Memorize, after Interrogate', () => {
    expect(neighbours('interrogate').next?.id).toBe('memorize');
  });

  it('returns nulls for an unknown id', () => {
    expect(neighbours('nope')).toEqual({ prev: null, next: null });
  });
});

describe('labels and links', () => {
  it('labels numbered steps and companions', () => {
    expect(stepLabel(stepById('pronouns')!)).toBe('Step 6 — Pronouns');
    expect(stepLabel(stepById('memorize')!)).toBe('Memorize the Scroll');
  });

  it('builds router links', () => {
    expect(stepLink(stepById('scroll')!, 's1')).toEqual(['/scroll', 's1']);
    expect(stepLink(stepById('figures')!, 's1')).toEqual(['/scroll', 's1', 'figures']);
  });
});
