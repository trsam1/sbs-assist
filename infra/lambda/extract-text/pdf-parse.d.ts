/**
 * Minimal typings for `pdf-parse` v1's internal lib module, which ships no type
 * declarations. We only use the extracted `text`.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export = pdfParse;
}
