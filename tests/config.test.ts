import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { isApiKeyValid } from '../src/security/downstream-auth.js';

describe('loadConfig', () => {
  it('refuses to run without an API key', () => {
    expect(() => loadConfig({})).toThrow(/WKB2API_API_KEY/);
  });

  it('refuses short keys', () => {
    expect(() => loadConfig({ WKB2API_API_KEY: 'short' })).toThrow();
  });

  it('defaults to loopback and 7891', () => {
    const cfg = loadConfig({
      WKB2API_API_KEY: 'x'.repeat(20),
      WKB2API_ACCOUNT_STORE_KEY_FILE: 'test-account-store.key',
    });
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(7891);
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ WKB2API_API_KEY: 'x'.repeat(20), PORT: '99999' })).toThrow();
  });
});

describe('isApiKeyValid', () => {
  it('rejects missing, wrong, and accepts exact', () => {
    expect(isApiKeyValid(undefined, 'k'.repeat(20))).toBe(false);
    expect(isApiKeyValid('nope', 'k'.repeat(20))).toBe(false);
    expect(isApiKeyValid('k'.repeat(20), 'k'.repeat(20))).toBe(true);
  });
});
