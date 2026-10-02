/**
 * Shared CORS response helpers for Lambda handlers.
 *
 * Allowed origins come from the ALLOWED_ORIGINS environment variable (comma-separated),
 * set by CDK per stage. It is read per call, so tests can stub it freely.
 */

type Headers = Record<string, string | undefined> | null | undefined;

/** The configured allowed origins, in order. The first one is the fallback. */
export function allowedOrigins(): string[] {
  return (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/** Case-insensitive lookup of the request's `Origin` header. */
export function getRequestOrigin(headers?: Headers): string | undefined {
  if (!headers) return undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'origin') return value;
  }
  return undefined;
}

/**
 * Build a Lambda proxy-integration response with CORS headers.
 * Echoes the request origin when it is allowed; otherwise returns the first allowed
 * origin, so the browser blocks a mismatched caller.
 */
export function corsResponse(
  statusCode: number,
  body: unknown,
  requestOrigin?: string,
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const origins = allowedOrigins();
  const allowOrigin = requestOrigin && origins.includes(requestOrigin) ? requestOrigin : (origins[0] ?? '');
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      Vary: 'Origin',
    },
    body: JSON.stringify(body),
  };
}
