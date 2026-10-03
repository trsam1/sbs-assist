import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  getTestament,
  isAllowedUpload,
  uploadExtension,
  validateStrongsNumber,
} from './validation';

describe('getTestament', () => {
  it("returns OT for Hebrew Strong's numbers", () => {
    expect(getTestament('H157')).toBe('OT');
    expect(getTestament('H1')).toBe('OT');
    expect(getTestament('H9999')).toBe('OT');
  });

  it("returns NT for Greek Strong's numbers", () => {
    expect(getTestament('G25')).toBe('NT');
    expect(getTestament('G1')).toBe('NT');
    expect(getTestament('G5624')).toBe('NT');
  });

  /**
   * **Validates: Requirements 1.2**
   * Property: For any Strong's number starting with 'H', getTestament returns 'OT';
   * for any starting with 'G', it returns 'NT'.
   */
  it('returns OT for any valid H-prefixed number and NT for any valid G-prefixed number', () => {
    const positiveInt = fc.integer({ min: 1, max: 99999 });

    fc.assert(
      fc.property(positiveInt, (num) => {
        expect(getTestament(`H${num}`)).toBe('OT');
        expect(getTestament(`G${num}`)).toBe('NT');
      }),
    );
  });
});

describe('uploadExtension / isAllowedUpload', () => {
  it('accepts the three supported extensions', () => {
    expect(uploadExtension('book.pdf')).toBe('pdf');
    expect(uploadExtension('book.docx')).toBe('docx');
    expect(uploadExtension('book.txt')).toBe('txt');
    expect(isAllowedUpload('book.pdf')).toBe(true);
    expect(isAllowedUpload('book.docx')).toBe(true);
    expect(isAllowedUpload('book.txt')).toBe(true);
  });

  it('lower-cases a mixed-case extension', () => {
    expect(uploadExtension('BOOK.PDF')).toBe('pdf');
    expect(uploadExtension('Genesis.Docx')).toBe('docx');
    expect(isAllowedUpload('BOOK.PDF')).toBe(true);
    expect(isAllowedUpload('Genesis.Docx')).toBe(true);
  });

  it('rejects a filename with no extension', () => {
    expect(uploadExtension('book')).toBeNull();
    expect(uploadExtension('book.')).toBeNull();
    expect(isAllowedUpload('book')).toBe(false);
  });

  it('rejects a disallowed extension', () => {
    expect(uploadExtension('book.doc')).toBeNull();
    expect(uploadExtension('book.rtf')).toBeNull();
    expect(isAllowedUpload('book.doc')).toBe(false);
    expect(isAllowedUpload('book.rtf')).toBe(false);
  });

  it('reads only the final extension', () => {
    expect(uploadExtension('archive.pdf.txt')).toBe('txt');
    expect(uploadExtension('scan.txt.doc')).toBeNull();
  });

  /**
   * Property: For any filename, `isAllowedUpload` returns `true` iff the lower-cased
   * extension is one of pdf/docx/txt. Mirrors the `getTestament` property above.
   */
  it('isAllowedUpload is true iff the lower-cased extension is in the allowed set', () => {
    const segment = fc.stringMatching(/^[A-Za-z0-9]{1,8}$/);
    fc.assert(
      fc.property(segment, segment, (base, ext) => {
        const filename = `${base}.${ext}`;
        const expected = (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(
          ext.toLowerCase(),
        );
        expect(isAllowedUpload(filename)).toBe(expected);
      }),
    );
  });
});
