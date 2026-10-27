/**
 * The seven biblical genres from the Step 7 reference's characteristics table, offered as
 * free-text suggestions for both the dominant-`genre` field and the secondary-genre spans in the
 * Structure Study worksheet. Single source of truth so the two controls share one vocabulary.
 * The inputs remain free-text — this is a datalist of suggestions, not a closed picker.
 */
export const BIBLICAL_GENRES: readonly string[] = [
  'historical narrative',
  'law',
  'poetry',
  'wisdom',
  'prophecy',
  'letter/epistle',
  'apocalyptic',
];
