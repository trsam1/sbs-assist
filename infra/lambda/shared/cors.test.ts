import { describe, it, expect, afterEach, vi } from 'vitest';
import { allowedOrigins, corsResponse, getRequestOrigin } from './cors';

const SITE = 'https://axiostools-dev.teksnextdoor.com';
const LOCAL = 'http://localhost:4200';

describe('cors', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses ALLOWED_ORIGINS, trimming and dropping empty entries', () => {
    vi.stubEnv('ALLOWED_ORIGINS', ` ${SITE} , ,${LOCAL}`);
    expect(allowedOrigins()).toEqual([SITE, LOCAL]);
  });

  it('echoes an allowed request origin', () => {
    vi.stubEnv('ALLOWED_ORIGINS', `${SITE},${LOCAL}`);
    const res = corsResponse(200, {}, LOCAL);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(LOCAL);
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('returns the first allowed origin for an unknown origin', () => {
    vi.stubEnv('ALLOWED_ORIGINS', `${SITE},${LOCAL}`);
    expect(
      corsResponse(200, {}, 'https://evil.example').headers['Access-Control-Allow-Origin'],
    ).toBe(SITE);
  });

  it('returns the first allowed origin when the origin is missing', () => {
    vi.stubEnv('ALLOWED_ORIGINS', `${SITE},${LOCAL}`);
    expect(corsResponse(200, {}).headers['Access-Control-Allow-Origin']).toBe(SITE);
  });

  it('finds a capitalised Origin header', () => {
    expect(getRequestOrigin({ Origin: LOCAL })).toBe(LOCAL);
    expect(getRequestOrigin({ origin: LOCAL })).toBe(LOCAL);
    expect(getRequestOrigin({ 'Content-Type': 'x' })).toBeUndefined();
    expect(getRequestOrigin(null)).toBeUndefined();
    expect(getRequestOrigin(undefined)).toBeUndefined();
  });

  it("returns '' when ALLOWED_ORIGINS is empty", () => {
    vi.stubEnv('ALLOWED_ORIGINS', '');
    expect(corsResponse(200, {}, LOCAL).headers['Access-Control-Allow-Origin']).toBe('');
  });

  it('keeps the other CORS headers and serializes the body', () => {
    vi.stubEnv('ALLOWED_ORIGINS', SITE);
    const res = corsResponse(201, { a: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe('{"a":1}');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET,POST,DELETE,OPTIONS');
  });
});
