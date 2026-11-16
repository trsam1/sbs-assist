import { describe, expect, it } from 'vitest';
import { reciteDiff } from './recite-diff';

const missed = (d: ReturnType<typeof reciteDiff>) =>
  d.verse.filter((t) => !t.matched).map((t) => t.text);
const extra = (d: ReturnType<typeof reciteDiff>) =>
  d.said.filter((t) => !t.matched).map((t) => t.text);

describe('reciteDiff', () => {
  it('flags nothing for a perfect recitation, ignoring case and punctuation', () => {
    const d = reciteDiff('For God so loved the world,', 'for god so loved the world');
    expect(missed(d)).toEqual([]);
    expect(extra(d)).toEqual([]);
  });

  it('keeps original casing and punctuation in display tokens', () => {
    const d = reciteDiff('For God so loved the world,', 'for god');
    expect(d.verse.map((t) => t.text)).toEqual(['For', 'God', 'so', 'loved', 'the', 'world,']);
  });

  it('flags a dropped word by position', () => {
    const d = reciteDiff('God so loved the world', 'God loved the world');
    expect(d.verse.map((t) => t.matched)).toEqual([true, false, true, true, true]);
  });

  it('flags the right occurrence of a repeated word', () => {
    // The student dropped the second "the".
    const d = reciteDiff('the Lord is the shepherd', 'the Lord is shepherd');
    expect(d.verse.map((t) => t.matched)).toEqual([true, true, true, false, true]);
  });

  it('shows a substitution as a miss in the verse and an extra in the transcript', () => {
    const d = reciteDiff('The Lord is my shepherd', 'The God is my shepherd');
    expect(missed(d)).toEqual(['Lord']);
    expect(extra(d)).toEqual(['God']);
  });

  it('flags added words in the transcript', () => {
    const d = reciteDiff('God loved the world', 'God so loved the whole world');
    expect(missed(d)).toEqual([]);
    expect(extra(d)).toEqual(['so', 'whole']);
  });

  it('marks every verse word missed for an empty transcript', () => {
    const d = reciteDiff('In the beginning', '');
    expect(d.said).toEqual([]);
    expect(missed(d)).toEqual(['In', 'the', 'beginning']);
  });

  it('never flags bare numerals such as verse numbers', () => {
    const d = reciteDiff('1 In the beginning', 'in the beginning');
    expect(missed(d)).toEqual([]);
  });

  it('drops tokens that are only punctuation', () => {
    const d = reciteDiff('Love — never fails', 'love never fails');
    expect(d.verse.map((t) => t.text)).toEqual(['Love', 'never', 'fails']);
    expect(missed(d)).toEqual([]);
  });
});
