import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock the two parser libraries so extract.ts can be unit-tested without real PDF/DOCX
// binaries and without reaching any native/IO path.
const { mockPdfParse, mockExtractRawText } = vi.hoisted(() => ({
  mockPdfParse: vi.fn(),
  mockExtractRawText: vi.fn(),
}));

vi.mock('pdf-parse/lib/pdf-parse.js', () => ({ default: mockPdfParse }));
vi.mock('mammoth', () => ({ extractRawText: mockExtractRawText }));

import { extractText } from './extract';

describe('extractText', () => {
  beforeEach(() => {
    mockPdfParse.mockReset();
    mockExtractRawText.mockReset();
  });

  describe('txt', () => {
    it('decodes UTF-8 text', async () => {
      const result = await extractText(Buffer.from('In the beginning', 'utf8'), 'txt');
      expect(result).toEqual({ ok: true, text: 'In the beginning' });
    });

    it('fails on an empty or whitespace-only file', async () => {
      const empty = await extractText(Buffer.from('', 'utf8'), 'txt');
      expect(empty.ok).toBe(false);
      const blank = await extractText(Buffer.from('   \n\t ', 'utf8'), 'txt');
      expect(blank.ok).toBe(false);
    });
  });

  describe('pdf', () => {
    it('returns the extracted text layer', async () => {
      mockPdfParse.mockResolvedValueOnce({ text: 'Genesis chapter one' });
      const result = await extractText(Buffer.from('%PDF-1.4'), 'pdf');
      expect(result).toEqual({ ok: true, text: 'Genesis chapter one' });
    });

    it('fails for an image-only PDF (no text layer)', async () => {
      mockPdfParse.mockResolvedValueOnce({ text: '   ' });
      const result = await extractText(Buffer.from('%PDF-1.4'), 'pdf');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/scanned images/i);
    });

    it('maps a parser error to a typed failure (never throws)', async () => {
      mockPdfParse.mockRejectedValueOnce(new Error('bad xref'));
      const result = await extractText(Buffer.from('%PDF-1.4'), 'pdf');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/bad xref/);
    });
  });

  describe('docx', () => {
    it('returns the raw text (no HTML)', async () => {
      mockExtractRawText.mockResolvedValueOnce({ value: 'For God so loved', messages: [] });
      const result = await extractText(Buffer.from('PK\u0003\u0004'), 'docx');
      expect(result).toEqual({ ok: true, text: 'For God so loved' });
    });

    it('fails when the document has no text', async () => {
      mockExtractRawText.mockResolvedValueOnce({ value: '', messages: [] });
      const result = await extractText(Buffer.from('PK\u0003\u0004'), 'docx');
      expect(result.ok).toBe(false);
    });

    it('maps a mammoth error to a typed failure', async () => {
      mockExtractRawText.mockRejectedValueOnce(new Error('not a zip'));
      const result = await extractText(Buffer.from('PK'), 'docx');
      expect(result.ok).toBe(false);
    });
  });

  /**
   * Property: `extractText` never throws for any Buffer of a supported type; it always
   * resolves to a typed result. (Requirement 2 correctness property.)
   */
  it('never throws for arbitrary buffers of any supported type', async () => {
    mockPdfParse.mockImplementation(async (buf: Buffer) => ({ text: buf.toString('utf8') }));
    mockExtractRawText.mockImplementation(async (input: { buffer: Buffer }) => ({
      value: input.buffer.toString('utf8'),
      messages: [],
    }));

    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array(),
        fc.constantFrom('pdf', 'docx', 'txt'),
        async (bytes, ext) => {
          const result = await extractText(Buffer.from(bytes), ext as 'pdf' | 'docx' | 'txt');
          expect(typeof result.ok).toBe('boolean');
          if (result.ok) {
            expect(typeof result.text).toBe('string');
          } else {
            expect(typeof result.reason).toBe('string');
          }
        },
      ),
    );
  });
});
