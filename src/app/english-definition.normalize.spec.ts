import { describe, it, expect } from 'vitest';
import { normalizeEnglishDefinition } from './english-definition.normalize';
import { EnglishDefinitionData } from './models';

describe('normalizeEnglishDefinition', () => {
  it('wraps a legacy string as a single meaning with empty part of speech', () => {
    expect(normalizeEnglishDefinition('  an intense feeling of deep affection ', 'love')).toEqual({
      word: 'love',
      meanings: [{ partOfSpeech: '', definitions: [{ definition: 'an intense feeling of deep affection' }] }],
    });
  });

  it('returns the object shape as is', () => {
    const data: EnglishDefinitionData = {
      word: 'love',
      phonetic: '/lʌv/',
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'affection' }] }],
    };
    expect(normalizeEnglishDefinition(data, 'love')).toBe(data);
  });

  it('returns null for an empty or whitespace string', () => {
    expect(normalizeEnglishDefinition('', 'love')).toBeNull();
    expect(normalizeEnglishDefinition('   ', 'love')).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(normalizeEnglishDefinition(null, 'love')).toBeNull();
    expect(normalizeEnglishDefinition(undefined, 'love')).toBeNull();
  });

  it('returns null for malformed values', () => {
    expect(normalizeEnglishDefinition({ meanings: 'x' }, 'love')).toBeNull();
    expect(normalizeEnglishDefinition({ word: 'love' }, 'love')).toBeNull();
    expect(normalizeEnglishDefinition(42, 'love')).toBeNull();
    expect(normalizeEnglishDefinition(true, 'love')).toBeNull();
  });
});
