import { environment, RuntimeConfig } from './environment';

const KEYS = ['apiUrl', 'cognitoUserPoolId', 'cognitoUserPoolClientId', 'cognitoRegion'] as const;

/** Validates raw /config.json content. Throws `Invalid runtime config: <field>`. */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid runtime config: not an object');
  }
  const obj = raw as Record<string, unknown>;
  for (const key of KEYS) {
    const value = obj[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Invalid runtime config: ${key}`);
    }
  }
  const cfg = obj as unknown as RuntimeConfig;
  if (!/^https:\/\//.test(cfg.apiUrl) && !/^http:\/\/localhost(:\d+)?/.test(cfg.apiUrl)) {
    throw new Error('Invalid runtime config: apiUrl');
  }
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(cfg.cognitoRegion)) {
    throw new Error('Invalid runtime config: cognitoRegion');
  }
  if (!cfg.cognitoUserPoolId.startsWith(`${cfg.cognitoRegion}_`)) {
    throw new Error('Invalid runtime config: cognitoUserPoolId');
  }
  return {
    apiUrl: cfg.apiUrl.replace(/\/+$/, ''),
    cognitoUserPoolId: cfg.cognitoUserPoolId,
    cognitoUserPoolClientId: cfg.cognitoUserPoolClientId,
    cognitoRegion: cfg.cognitoRegion,
  };
}

/**
 * Fetches and validates /config.json, then populates `environment`.
 * Uses `fetch`, not HttpClient, so no interceptor runs before Amplify is configured.
 */
export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfig> {
  const res = await fetchFn('/config.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`config.json HTTP ${res.status}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    // Also covers the SPA fallback returning index.html.
    throw new Error('config.json is not valid JSON');
  }
  const cfg = parseRuntimeConfig(raw);
  Object.assign(environment, cfg);
  return cfg;
}

/** Replaces the app shell with an accessible error message. No-op without <app-root>. */
export function showFatalConfigError(doc: Document = document): void {
  const root = doc.querySelector('app-root');
  if (!root) return;
  root.setAttribute('role', 'alert');
  root.textContent = 'The app could not load its configuration. Please refresh the page.';
}
