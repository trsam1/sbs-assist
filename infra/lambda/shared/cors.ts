/**
 * Shared CORS response helpers for Lambda handlers.
 *
 * The allowed origin is read from the ALLOWED_ORIGIN environment variable,
 * which is set by CDK to the CloudFront distribution domain.
 */

const allowedOrigin = process.env['ALLOWED_ORIGIN'] ?? '';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
};

/** Build a Lambda proxy-integration response with CORS headers. */
export function corsResponse(statusCode: number, body: unknown): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}
