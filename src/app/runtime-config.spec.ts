import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadRuntimeConfig, parseRuntimeConfig, showFatalConfigError } from './runtime-config';
import { environment } from './environment';

const VALID = {
  apiUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com/dev/',
  cognitoUserPoolId: 'us-east-1_EXAMPLE',
  cognitoUserPoolClientId: 'example-client-id',
  cognitoRegion: 'us-east-1',
};

/** A minimal fetch Response stand-in; `json` rejects when `body` is a SyntaxError. */
function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  } as Response;
}

describe('parseRuntimeConfig', () => {
  it('accepts a valid config and strips the trailing slash from apiUrl', () => {
    expect(parseRuntimeConfig(VALID)).toEqual({
      ...VALID,
      apiUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com/dev',
    });
  });

  it('accepts http://localhost with a port', () => {
    expect(parseRuntimeConfig({ ...VALID, apiUrl: 'http://localhost:3000' }).apiUrl).toBe(
      'http://localhost:3000',
    );
  });

  it('rejects non-objects', () => {
    expect(() => parseRuntimeConfig(null)).toThrow('Invalid runtime config');
    expect(() => parseRuntimeConfig('x')).toThrow('Invalid runtime config');
    expect(() => parseRuntimeConfig([])).toThrow('Invalid runtime config');
  });

  for (const key of Object.keys(VALID)) {
    it(`rejects a missing or empty ${key}`, () => {
      const missing: Record<string, unknown> = { ...VALID };
      delete missing[key];
      expect(() => parseRuntimeConfig(missing)).toThrow(`Invalid runtime config: ${key}`);
      expect(() => parseRuntimeConfig({ ...VALID, [key]: '' })).toThrow(
        `Invalid runtime config: ${key}`,
      );
      expect(() => parseRuntimeConfig({ ...VALID, [key]: 42 })).toThrow(
        `Invalid runtime config: ${key}`,
      );
    });
  }

  it('rejects a non-https, non-localhost apiUrl', () => {
    expect(() => parseRuntimeConfig({ ...VALID, apiUrl: 'http://example.com' })).toThrow(
      'Invalid runtime config: apiUrl',
    );
  });

  it('rejects a malformed region', () => {
    expect(() => parseRuntimeConfig({ ...VALID, cognitoRegion: 'useast1' })).toThrow(
      'Invalid runtime config: cognitoRegion',
    );
  });

  it('rejects a pool ID from another region', () => {
    expect(() => parseRuntimeConfig({ ...VALID, cognitoUserPoolId: 'us-west-2_EXAMPLE' })).toThrow(
      'Invalid runtime config: cognitoUserPoolId',
    );
  });
});

describe('loadRuntimeConfig', () => {
  const blank = {
    apiUrl: '',
    cognitoUserPoolId: '',
    cognitoUserPoolClientId: '',
    cognitoRegion: '',
  };

  afterEach(() => {
    Object.assign(environment, blank);
  });

  it('fetches /config.json without cache and populates environment', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse(200, VALID));
    const cfg = await loadRuntimeConfig(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/config.json', { cache: 'no-store' });
    expect(cfg.apiUrl).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/dev');
    expect(environment).toEqual(cfg);
  });

  it('throws on a non-2xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse(404, null));
    await expect(loadRuntimeConfig(fetchFn)).rejects.toThrow('config.json HTTP 404');
    expect(environment.apiUrl).toBe('');
  });

  it('throws when the body is HTML (SPA fallback)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, new SyntaxError('Unexpected token <')));
    await expect(loadRuntimeConfig(fetchFn)).rejects.toThrow('config.json is not valid JSON');
  });

  it('throws when the config is invalid', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse(200, { ...VALID, cognitoRegion: '' }));
    await expect(loadRuntimeConfig(fetchFn)).rejects.toThrow(
      'Invalid runtime config: cognitoRegion',
    );
    expect(environment.apiUrl).toBe('');
  });

  it('propagates a fetch rejection', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loadRuntimeConfig(fetchFn)).rejects.toThrow('Failed to fetch');
  });
});

describe('showFatalConfigError', () => {
  it('replaces <app-root> content with an alert', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<app-root><p>loading</p></app-root>';
    showFatalConfigError(doc);
    const root = doc.querySelector('app-root');
    expect(root?.getAttribute('role')).toBe('alert');
    expect(root?.textContent).toBe(
      'The app could not load its configuration. Please refresh the page.',
    );
  });

  it('does nothing when <app-root> is missing', () => {
    const doc = document.implementation.createHTMLDocument('t');
    expect(() => showFatalConfigError(doc)).not.toThrow();
    expect(doc.body.textContent).toBe('');
  });
});
