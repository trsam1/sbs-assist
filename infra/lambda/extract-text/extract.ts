import type { UploadExtension } from '../shared/validation';

// pdf-parse v1 ships a debug harness in its index.js that reads a test file at module
// load; importing the lib module directly avoids that and bundles cleanly under esbuild.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import * as mammoth from 'mammoth';

/** Result of a text extraction attempt. Never throws; failures are typed. */
export type ExtractResult = { ok: true; text: string } | { ok: false; reason: string };

const EMPTY_PDF_REASON = 'No extractable text (the PDF may be scanned images).';

/**
 * Extract plain UTF-8 text from an uploaded document buffer.
 *
 * Supported types:
 * - `txt`  → decoded as UTF-8; empty/whitespace-only → failure.
 * - `pdf`  → `pdf-parse`; image-only/empty PDFs → failure.
 * - `docx` → `mammoth.extractRawText` (plain text, no HTML).
 *
 * This function never throws: any library error is caught and mapped to a typed failure.
 */
export async function extractText(buf: Buffer, ext: UploadExtension): Promise<ExtractResult> {
  try {
    switch (ext) {
      case 'txt': {
        const text = buf.toString('utf8');
        if (text.trim().length === 0) {
          return { ok: false, reason: 'The file is empty.' };
        }
        return { ok: true, text };
      }
      case 'pdf': {
        const result = await pdfParse(buf);
        const text = typeof result?.text === 'string' ? result.text : '';
        if (text.trim().length === 0) {
          return { ok: false, reason: EMPTY_PDF_REASON };
        }
        return { ok: true, text };
      }
      case 'docx': {
        const result = await mammoth.extractRawText({ buffer: buf });
        const text = typeof result?.value === 'string' ? result.value : '';
        if (text.trim().length === 0) {
          return { ok: false, reason: 'No extractable text in the Word document.' };
        }
        return { ok: true, text };
      }
      default: {
        return { ok: false, reason: `Unsupported file type: ${ext as string}` };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Could not read the file: ${message}` };
  }
}
