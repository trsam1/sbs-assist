/** Shared validation utilities for the Bible Word Study Tool backend. */

const STRONGS_PATTERN = /^[GH]\d+$/;

/**
 * Validates that the input string is a valid Strong's concordance number.
 * Valid format: 'G' or 'H' followed by one or more digits (e.g., "G25", "H157").
 */
export function validateStrongsNumber(input: string): boolean {
  return STRONGS_PATTERN.test(input);
}

/**
 * Returns the testament for a given Strong's concordance number.
 * 'H' prefix (Hebrew) → Old Testament, 'G' prefix (Greek) → New Testament.
 *
 * @param strongsNumber A validated Strong's number matching `/^[GH]\d+$/`
 */
export function getTestament(strongsNumber: string): 'OT' | 'NT' {
  return strongsNumber.startsWith('H') ? 'OT' : 'NT';
}
