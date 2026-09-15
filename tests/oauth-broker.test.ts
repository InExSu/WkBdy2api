import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthBroker, OAuthError, AUTH_ORIGIN } from '../src/workbuddy/oauth-broker.js';
import { CredentialPool } from '../src/workbuddy/credential-pool.js';
import type { WorkBuddyCredential } from '../src/workbuddy/auth.js';

vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number, value: unknown, opts: { signal?: AbortSignal } = {}) => new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error('cancelled')); };
    const timer = setTimeout(() => { opts.signal?.removeEventListener('abort', onAbort); resolve(value); }, ms);
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
  }),
}));

const TOKEN = 'mock-access-for-oauth-test';
const REFRESH = 'mock-refresh-for-oauth-test';
const STATE = 'mock-official-state-only-server';
const auth = { accessToken: TOKEN, refreshToken: REFRESH, tokenType: 'Bearer' as const, expiresIn: 3600, refreshExpiresIn: 7200 };
const envelope = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, data }), { status });
const cred = (): WorkBuddyCredential => ({ ...auth, userId: 'test-subject', domain: 'www.workbuddy.ai', oauthOrigin: AUTH_ORIGIN, expiresAt: Date.now() + 30_000 });
const brokers: OAuthBroker[] = [];

function setup(overrides: Partial<Record<string, () => Response | Promise<Response>>> = {}, options: { timeout?: number; onComplete?: (c: WorkBuddyCredential) => Promise<string> } = {}) {
  const paths = {
    '/auth/state': () => envelope({ authUrl: AUTH_ORIGIN + '/login?state=' + STATE, state: STATE }),
    '/auth/token': () => envelope(auth),
    '/login/account': () => envelope({ uid: 'test-subject' }),
    '/accounts': () => envelope({ accounts: [{ uid: 'test-subject' }, { uid: 'test-subject', type: 'organization' }] }),
    '/auth/token/refresh': () => envelope({ ...auth, accessToken: TOKEN + '-new', refreshToken: REFRESH + '-new' }),
    ...overrides,
  };
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url).startsWith(AUTH_ORIGIN + '/v2/plugin/')).toBe(true);
    expect(init?.redirect).toBe('error');
    const path = new URL(String(url)).pathname.replace('/v2/plugin', '') as keyof typeof paths;
    const handler = paths[path];
    if (!handler) throw new Error('unexpected route');
    return handler();
  });
  const onComplete = vi.fn(options.onComplete ?? (async () => '#1'));
  const broker = new OAuthBroker({ fetchFn: fetchFn as typeof fetch, onComplete, pollIntervalMs: 10, loginTimeoutMs: options.timeout ?? 500 });
  brokers.push(broker);
  return { broker, onComplete, fetchFn };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { brokers.splice(0).forEach((b) => b.close()); vi.useRealTimers(); });

describe('official login broker', () => {
  it('runs state → token → account → accounts and publishes once without exposing secrets', async () => {
    const { broker, onComplete, fetchFn } = setup();
    const started = await broker.start('browser-a');
    expect(started.status).toBe('pending');
    expect(started.id).not.toBe(STATE);
    expect(started.authorization_url).toContain('version=2.137.1');
    await vi.advanceTimersByTimeAsync(60);
    const status = broker.status(started.id, 'browser-a');
    expect(status.status).toBe('completed');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ accessToken: TOKEN, refreshToken: REFRESH, userId: 'test-subject', expiresAt: expect.any(Number) });
    expect(JSON.stringify(status)).not.toMatch(/mock-|test-subject/);
    expect(broker.cancel(started.id, 'browser-a').status).toBe('completed');
    const headers = fetchFn.mock.calls.map(([, init]) => init?.headers as Record<string, string>);
    expect(headers[0]?.Authorization).toBeUndefined();
    expect(headers[1]?.Authorization).toBeUndefined();
    expect(headers[2]?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers[2]?.['X-User-Id']).toBeUndefined();
  });

  it('waits on 11217 and 12151 then succeeds', async () => {
    let tokenCalls = 0, accountCalls = 0;
    const { broker, onComplete } = setup({
      '/auth/token': () => ++tokenCalls === 1 ? envelope(null, 11217, 400) : envelope(auth),
      '/login/account': () => ++accountCalls === 1 ? envelope(null, 12151, 400) : envelope({ uid: 'test-subject' }),
    });
    const started = await broker.start('browser-a');
    await vi.advanceTimersByTimeAsync(100);
    expect(broker.status(started.id, 'browser-a').status).toBe('completed');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(tokenCalls).toBe(2);
    expect(accountCalls).toBe(2);
  });

  it('binds sessions to a browser and rejects concurrent starts', async () => {
    const { broker } = setup({ '/auth/token': () => envelope(null, 11217) });
    const started = await broker.start('browser-a');
    expect(() => broker.status(started.id, 'browser-b')).toThrow('oauth_session_not_found');
    expect(() => broker.cancel(started.id, 'browser-b')).toThrow('oauth_session_not_found');
    await expect(broker.start('browser-a')).rejects.toThrow('oauth_already_pending');
    expect(broker.cancel(started.id, 'browser-a').status).toBe('cancelled');
    expect(broker.cancel(started.id, 'browser-a').status).toBe('cancelled');
    await expect(broker.start('browser-a')).resolves.toMatchObject({ status: 'pending' });
  });

  it('expires pending authorization and never inserts an account', async () => {
    const { broker, onComplete, fetchFn } = setup({ '/auth/token': () => envelope(null, 11217) }, { timeout: 35 });
    const started = await broker.start('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(broker.status(started.id, 'a').status).toBe('expired');
    const count = fetchFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchFn).toHaveBeenCalledTimes(count);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ignores a late account response after cancellation', async () => {
    let resolveAccount!: (r: Response) => void;
    const { broker, onComplete } = setup({ '/login/account': () => new Promise((resolve) => { resolveAccount = resolve; }) });
    const started = await broker.start('a');
    await vi.advanceTimersByTimeAsync(30);
    broker.cancel(started.id, 'a');
    resolveAccount(envelope({ uid: 'test-subject' }));
    await vi.advanceTimersByTimeAsync(30);
    expect(broker.status(started.id, 'a').status).toBe('cancelled');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(['http://www.workbuddy.ai/login', 'https://www.workbuddy.ai.evil.test/login', 'https://name:password@www.workbuddy.ai/login', 'https://example.com/login'])('rejects unsafe authorization URL %s', async (authUrl) => {
    const { broker } = setup({ '/auth/state': () => envelope({ authUrl, state: STATE }) });
    await expect(broker.start('a')).rejects.toThrow('oauth_untrusted_authorization_url');
  });

  it.each([
    ['mismatched identity', '/accounts', { accounts: [{ uid: 'another-subject' }] }],
    ['wrong domain', '/auth/token', { ...auth, domain: 'evil.test' }],
    ['missing token', '/auth/token', { refreshToken: REFRESH }],
  ])('rejects %s', async (_name, path, data) => {
    const { broker, onComplete } = setup({ [path as string]: () => envelope(data) });
    const started = await broker.start('a');
    await vi.advanceTimersByTimeAsync(70);
    expect(broker.status(started.id, 'a').status).toBe('failed');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not retry 429 or echo upstream error content', async () => {
    const { broker, fetchFn } = setup({ '/auth/token': () => envelope({ message: TOKEN }, 11217, 429) });
    const started = await broker.start('a');
    await vi.advanceTimersByTimeAsync(60);
    expect(broker.status(started.id, 'a')).toMatchObject({ status: 'failed', error: 'oauth_rate_limited' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('refreshes using the official refresh header and verifies the account identity', async () => {
    const { broker, fetchFn } = setup();
    const updated = await broker.refreshCredential(cred());
    expect(updated.accessToken).toBe(TOKEN + '-new');
    expect(updated.refreshToken).toBe(REFRESH + '-new');
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Refresh-Token': REFRESH, 'X-Auth-Refresh-Source': 'plugin' });
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe('{}');
  });

  it('repeated login updates the same pool account instead of duplicating it', async () => {
    const pool = new CredentialPool();
    const { broker } = setup({}, { onComplete: async (c) => (await pool.add(c)).label });
    await broker.start('a'); await vi.advanceTimersByTimeAsync(60);
    await broker.start('a'); await vi.advanceTimersByTimeAsync(60);
    expect(pool.size).toBe(1);
  });
});

describe('OAuth credentials in the pool', () => {
  it('single-flights expiry refresh and does not resurrect a deleted account', async () => {
    const pool = new CredentialPool();
    let complete!: (c: WorkBuddyCredential) => void;
    const refresh = vi.fn(() => new Promise<WorkBuddyCredential>((resolve) => { complete = resolve; }));
    pool.setRefresher(refresh);
    const account = await pool.add(cred());
    const first = pool.getCredential(), second = pool.getCredential();
    const settled = Promise.allSettled([first, second]);
    expect(refresh).toHaveBeenCalledTimes(1);
    await pool.remove(account.label);
    complete({ ...cred(), accessToken: 'rotated' });
    expect((await settled).map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(pool.size).toBe(0);
  });

  it('preserves a concurrent re-login when an older refresh fails', async () => {
    const pool = new CredentialPool();
    let fail!: (reason: unknown) => void;
    pool.setRefresher(() => new Promise((_resolve, reject) => { fail = reject; }));
    await pool.add(cred());
    const request = pool.getCredential();
    const checked = expect(request).rejects.toThrow('refresh failed');
    await pool.add({ ...cred(), accessToken: 'new-login', expiresAt: Date.now() + 3_600_000 });
    fail(new OAuthError(401, 'oauth_reauthentication_required'));
    await checked;
    expect((await pool.getCredential()).accessToken).toBe('new-login');
  });

  it('keeps account labels stable and never issues quarantined accounts', async () => {
    const pool = new CredentialPool();
    await pool.add({ ...cred(), expiresAt: undefined });
    await pool.add({ ...cred(), userId: 'second', accessToken: 'second-token', expiresAt: undefined });
    await pool.remove('#1');
    expect(pool.list()[0]?.label).toBe('#2');
    pool.reportFailure('second-token');
    await expect(pool.getCredential()).rejects.toThrow('No available account');
    await pool.add({ ...cred(), userId: 'third', expiresAt: undefined });
    expect(pool.list()[1]?.label).toBe('#3');
  });
});
