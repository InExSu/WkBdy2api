import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { CredentialPool } from '../src/workbuddy/credential-pool.js';
import { CredentialStore } from '../src/workbuddy/credential-store.js';
import { WorkBuddyClient, type UpstreamDiagnostic } from '../src/workbuddy/client.js';
import { buildCatalog, parseProductConfig } from '../src/workbuddy/model-catalog.js';
import { createMetrics } from '../src/observability/metrics.js';

const KEY = 'local-regression-downstream-key';
const fixture = await readFile(new URL('../fixtures/upstream-stream.redacted.txt', import.meta.url), 'utf8');
const models = buildCatalog(parseProductConfig(JSON.parse(await readFile(new URL('../wb_v3config.public.json', import.meta.url), 'utf8'))));
const apps: FastifyInstance[] = [];
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});
const auth = { authorization: 'Bearer ' + KEY };
const requestBody = (path: string, model = 'deepseek-v4.1-flash', stream = false) => path.endsWith('/responses')
  ? { model, input: 'Local test', stream }
  : { model, messages: [{ role: 'user', content: 'Local test' }], max_tokens: 32, stream };
const paths = ['/v1/chat/completions', '/v1/responses', '/v1/messages'];
function appFor(pool: CredentialPool, client: WorkBuddyClient) {
  const app = buildApp({ apiKey: KEY, models, pool, client, metrics: createMetrics(),
    upstreamUrl: 'http://127.0.0.1', upstreamUa: 'WorkBuddy/2.137.1', startedAt: Date.now(), version: 'regression' });
  apps.push(app); return app;
}
function seed(pool: CredentialPool) {
  pool.restore({ version: 1, strategy: 'round-robin', nextLabel: 3, accounts: ['one', 'two'].map((id, i) => ({
    label: '#' + (i + 1), credential: { accessToken: 'mock-' + id, userId: id, domain: 'www.workbuddy.ai' },
  })) });
}

describe('per-model context persistence through real local HTTP', () => {
  it('persists each model across a server restart and all three protocols share it across accounts', async () => {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    const dir = await mkdtemp(join(process.cwd(), 'data', 'regression-')); dirs.push(dir);
    const keyPath = join(dir, 'key'); const storePath = join(dir, 'accounts.enc');
    await writeFile(keyPath, randomBytes(32));
    const store = await CredentialStore.fromKeyFile(storePath, keyPath);
    const pool = new CredentialPool({ store }); seed(pool);
    const sent: Array<{ body: Record<string, unknown>; token: string | null }> = [];
    const clientFor = (p: CredentialPool) => new WorkBuddyClient({ credentials: p, upstreamUrl: 'http://mock.invalid/chat', userAgent: 'test/1',
      fetchFn: (async (_url, init) => {
        sent.push({ body: JSON.parse(String(init?.body)), token: new Headers(init?.headers).get('authorization') });
        return new Response(fixture);
      }) as typeof fetch });
    const first = appFor(pool, clientFor(pool));
    let url = await first.listen({ host: '127.0.0.1', port: 0 });
    for (const [model_id, context_window] of [['deepseek-v4.1-flash', 1000000], ['gpt-6-astra', 400000]] as const) {
      const res = await fetch(url + '/admin/api/context-window', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ model_id, context_window }) });
      expect(res.status).toBe(200); await res.json();
    }
    const overview = await (await fetch(url + '/admin/api/overview', { headers: auth })).json() as { pool: { context_window: Record<string, number> } };
    expect(overview.pool.context_window).toEqual({ 'deepseek-v4.1-flash': 1000000, 'gpt-6-astra': 400000 });
    await first.close(); apps.splice(apps.indexOf(first), 1);
    const recoveredStore = await CredentialStore.fromKeyFile(storePath, keyPath);
    const recovered = new CredentialPool({ store: recoveredStore }); recovered.restore((await recoveredStore.load())!);
    const second = appFor(recovered, clientFor(recovered));
    url = await second.listen({ host: '127.0.0.1', port: 0 });
    for (const path of paths) {
      for (const model of ['deepseek-v4.1-flash', 'gpt-6-astra']) {
        for (let i = 0; i < 2; i++) {
          const res = await fetch(url + path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(requestBody(path, model)) });
          expect(res.status).toBe(200); await res.json();
          expect(sent.at(-1)?.body.context_window).toBe(model === 'deepseek-v4.1-flash' ? 1000000 : 400000);
        }
        expect(sent.at(-1)?.token).not.toBe(sent.at(-2)?.token);
      }
    }
    for (const change of [{ model_id: 'missing', context_window: 1000000 }, { model_id: 'deepseek-v4.1-flash', context_window: 42 }]) {
      const res = await fetch(url + '/admin/api/context-window', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(change) });
      expect(res.status).toBeGreaterThanOrEqual(400); await res.json();
    }
    expect(recovered.getContextWindow('deepseek-v4.1-flash')).toBe(1000000);
  });
});

describe('upstream channel rejection', () => {
  it.each(paths)('classifies permission refusal on %s without retry or leaking secrets', async (path) => {
    const pool = new CredentialPool(); seed(pool);
    const diagnostics: UpstreamDiagnostic[] = [];
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ code: 12403,
      msg: 'Illegal API invocation from an unapproved channel mock-secret-private' }), { status: 400 }));
    const client = new WorkBuddyClient({ credentials: pool, upstreamUrl: 'http://mock.invalid', userAgent: 'test/1', fetchFn, onDiagnostic: (e) => diagnostics.push(e) });
    const app = appFor(pool, client);
    for (const stream of [false, true]) {
      const res = await app.inject({ method: 'POST', url: path, headers: auth, payload: requestBody(path, undefined, stream) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.type).toBe('permission_error');
      expect(res.body).not.toContain('mock-secret-private');
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(diagnostics.every((e) => e.result === 'channel_rejected')).toBe(true);
    expect(diagnostics.map((e) => e.account)).toEqual(['#1', '#2']);
    expect(JSON.stringify(diagnostics)).not.toMatch(/mock-secret|mock-one|mock-two|Local test/);
  });
});

describe('transport cancellation and errors after SSE starts', () => {
  it.each(paths)('closes the real upstream socket on client cancellation: %s', async (path) => {
    let opened = false, closed = false;
    const mock = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume test input */ }
      opened = true;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"start"},"finish_reason":""}]}\n\n');
      res.on('close', () => { closed = true; });
    }); servers.push(mock);
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
    const pool = new CredentialPool(); seed(pool);
    const client = new WorkBuddyClient({ credentials: pool, upstreamUrl: `http://127.0.0.1:${(mock.address() as { port: number }).port}/chat`, userAgent: 'test/1' });
    const app = appFor(pool, client);
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const res = await fetch(url + path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(requestBody(path, undefined, true)), signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();
    expect(opened).toBe(true);
    controller.abort();
    await reader.cancel().catch(() => {});
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it.each(paths)('does not claim completion after a streamed channel rejection: %s', async (path) => {
    const pool = new CredentialPool(); seed(pool);
    const fetchFn = vi.fn(async () => new Response('data: {"code":12403,"msg":"Illegal API invocation from an unapproved channel"}\n\ndata: [DONE]\n\n'));
    const app = appFor(pool, new WorkBuddyClient({ credentials: pool, upstreamUrl: 'http://mock.invalid', userAgent: 'test/1', fetchFn }));
    const res = await app.inject({ method: 'POST', url: path, headers: auth, payload: requestBody(path, undefined, true) });
    expect(res.body).toContain('permission_error');
    expect(res.body).not.toMatch(/event: message_stop|event: response.completed|data: \[DONE\]/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('overview does not consume accounts or start credential refresh', async () => {
    const pool = new CredentialPool(); seed(pool);
    const pick = vi.spyOn(pool, 'getCredential');
    const app = appFor(pool, new WorkBuddyClient({ credentials: pool, upstreamUrl: 'http://mock.invalid', userAgent: 'test/1' }));
    await app.inject({ url: '/admin/api/overview', headers: auth });
    expect(pick).not.toHaveBeenCalled();
  });
});

// Opt-in wall-clock test: real sockets and timers, no external inference or credentials.
it.runIf(process.env.WKB2API_LONG_STREAM_TEST === '1')('streams and delayed first output survive 65 seconds on every protocol', async () => {
  const delayMs = 65_000;
  const mock = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const mode = JSON.parse(body).messages.at(-1).content;
    let interval: ReturnType<typeof setInterval> | undefined;
    const headerDelay = mode === 'headers';
    if (!headerDelay) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); }
    if (mode === 'active') {
      interval = setInterval(() => res.write('data: {"choices":[{"delta":{"content":"."},"finish_reason":""}]}\n\n'), 5000);
    }
    const timer = setTimeout(() => {
      if (interval) clearInterval(interval);
      if (headerDelay) res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(fixture);
    }, delayMs);
    res.on('close', () => { clearTimeout(timer); if (interval) clearInterval(interval); });
  });
  servers.push(mock);
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const port = (mock.address() as { port: number }).port;
  const pool = new CredentialPool(); seed(pool);
  const client = new WorkBuddyClient({ credentials: pool, upstreamUrl: `http://127.0.0.1:${port}/chat`, userAgent: 'test/1' });
  const app = appFor(pool, client);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  await Promise.all(paths.flatMap((path) => ['active', 'idle', 'headers'].map(async (mode) => {
    const payload = requestBody(path, undefined, true);
    if ('input' in payload) payload.input = mode;
    else payload.messages[0]!.content = mode;
    const began = performance.now();
    const res = await fetch(url + path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90_000) });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader(); const decoder = new TextDecoder();
    let text = '', firstByteMs: number | undefined;
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      firstByteMs ??= performance.now() - began;
      text += decoder.decode(next.value, { stream: true });
    }
    const elapsed = performance.now() - began;
    expect(elapsed).toBeGreaterThan(64_000);
    expect(text).not.toContain('"type":"error"');
    expect(text).toContain(path.endsWith('/messages') ? 'event: message_stop' : path.endsWith('/responses') ? 'event: response.completed' : 'data: [DONE]');
    if (mode !== 'headers') {
      expect(firstByteMs).toBeLessThan(30_000);
      expect(text).toContain(': keep-alive');
    }
    console.log(JSON.stringify({ path, mode, elapsed_ms: Math.round(elapsed), first_byte_ms: Math.round(firstByteMs ?? 0), completed: true }));
  })));
}, 100_000);
