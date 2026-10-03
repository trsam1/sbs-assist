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

/** Maximum uploaded document size the extraction worker will process (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The upload file extensions supported by the Scroll Study tool. */
export const ALLOWED_UPLOAD_EXTENSIONS = ['pdf', 'docx', 'txt'] as const;

/** A supported upload extension. */
export type UploadExtension = (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];

/**
 * Returns the lower-cased file extension if it is a supported upload type
 * (`pdf`, `docx`, `txt`), otherwise `null`.
 */
export function uploadExtension(filename: string): UploadExtension | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as UploadExtension)
    : null;
}

/** Whether a filename has a supported upload extension (`pdf`, `docx`, `txt`). */
export function isAllowedUpload(filename: string): boolean {
  return uploadExtension(filename) !== null;
}
