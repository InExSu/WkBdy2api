import { describe, expect, it, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCatalog, parseProductConfig } from '../src/workbuddy/model-catalog.js';
import { WorkBuddyClient } from '../src/workbuddy/client.js';
import { createMetrics } from '../src/observability/metrics.js';
import { CredentialPool } from '../src/workbuddy/credential-pool.js';

const KEY = 'test-key-0123456789abcdef';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const live = JSON.parse(readFileSync(`${projectRoot}/wb_v3config_live.json`, 'utf8'));
const streamFixture = readFileSync(`${projectRoot}/fixtures/upstream-stream.redacted.txt`, 'utf8');
const toolFixture = readFileSync(`${projectRoot}/fixtures/upstream-tool-call.redacted.txt`, 'utf8');

/** Mock upstream: serves the fixture text as an SSE byte stream. Records the request. */
let lastUpstreamRequest: { url: string; headers: Record<string, string>; body: unknown } | undefined;

function fixtureClient(fixture: string): WorkBuddyClient {
  return new WorkBuddyClient({
    upstreamUrl: 'http://mock.local/v2/chat/completions',
    credentials: {
      getCredential: async () => ({ accessToken: 'mock-token', userId: 'mock-uid', domain: 'www.workbuddy.ai' }),
      invalidate: () => {},
      describe: () => 'mock',
    } as never,
    userAgent: 'WorkBuddy/2.137.1',
    fetchFn: (async (url: string, init: RequestInit) => {
      lastUpstreamRequest = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      };
      return new Response(sseStream(fixture), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch,
  });
}

function sseStream(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  // split at frame boundaries to prove chunk-independence; small jagged chunks
  const parts = text.split(/\n\n/).flatMap((f, i) => (i === 0 ? [f] : [f]));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
      let chunk = parts[i++];
      if (i < parts.length) chunk += '\n\n';
      controller.enqueue(enc.encode(chunk));
    },
  });
}

function build(client: WorkBuddyClient): FastifyInstance {
  return buildApp({
    apiKey: KEY,
    models: buildCatalog(parseProductConfig(live)),
    client,
    pool: new CredentialPool(),
    metrics: createMetrics(),
    upstreamUrl: 'http://mock.local/v2/chat/completions',
    upstreamUa: 'WorkBuddy/2.137.1',
    startedAt: Date.now(),
    version: 'test',
  });
}

describe('chat completions against fixture-driven mock upstream', () => {
  describe('non-stream (upstream stream + local aggregation)', () => {
    let app: FastifyInstance;
    beforeAll(() => {
      app = build(fixtureClient(streamFixture));
    });

    it('aggregates into a standard chat.completion', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: {
          model: 'deepseek-v4.1-flash',
          messages: [{ role: 'user', content: 'Reply with OK only.' }],
          stream: false,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('chat.completion');
      expect(body.id).toMatch(/^chatcmpl-/);
      expect(body.model).toBe('deepseek-v4.1-flash');
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0].message.role).toBe('assistant');
      expect(body.choices[0].message.content).toBe('OK');
      expect(body.choices[0].finish_reason).toBe('stop');
      expect(body.usage).toEqual({ prompt_tokens: 16, completion_tokens: 1, total_tokens: 17 });
      // upstream extension fields must not leak
      expect(JSON.stringify(body)).not.toContain('credit');
      expect(JSON.stringify(body)).not.toContain('prompt_cache');
    });

    it('sent stream:true to the upstream with injected system message and auth headers', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: {
          model: 'deepseek-v4.1-flash',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        },
      });
      const sent = lastUpstreamRequest!;
      expect(sent.body).toMatchObject({ stream: true, model: 'deepseek-v4.1-flash' });
      expect((sent.body as { messages: Array<{ role: string }> }).messages[0]!.role).toBe('system');
      expect(sent.headers['Authorization']).toBe('Bearer mock-token');
      expect(sent.headers['X-User-Id']).toBe('mock-uid');
      expect(sent.headers['X-Domain']).toBe('www.workbuddy.ai');
      expect(sent.headers['X-Product']).toBe('SaaS');
      expect(sent.headers['User-Agent']).toBe('WorkBuddy/2.137.1');
    });

    it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)(
      'forwards thinking=%s as reasoning_effort',
      async (effort) => {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/chat/completions',
          headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
          payload: {
            model: 'deepseek-v4.1-flash',
            messages: [{ role: 'user', content: 'hi' }],
            thinking: effort,
          },
        });

        expect(res.statusCode).toBe(200);
        expect(lastUpstreamRequest?.body).toMatchObject({ reasoning_effort: effort });
      },
    );

    it('accepts Cherry Studio thinking and optional undefined sentinels', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: {
          model: 'deepseek-v4.1-flash',
          user: '[undefined]',
          max_tokens: '[undefined]',
          temperature: '[undefined]',
          top_p: '[undefined]',
          frequency_penalty: '[undefined]',
          presence_penalty: '[undefined]',
          response_format: '[undefined]',
          stop: '[undefined]',
          seed: '[undefined]',
          thinking: { type: 'enabled' },
          reasoning_effort: 'high',
          serviceTier: '[undefined]',
          verbosity: '[undefined]',
          tools: '[undefined]',
          tool_choice: '[undefined]',
          messages: [{ role: 'user', content: '你好' }],
          stream: true,
          stream_options: { include_usage: true },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(lastUpstreamRequest?.body).toMatchObject({ reasoning_effort: 'high', stream: true });
      expect((lastUpstreamRequest?.body as Record<string, unknown>).messages).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: '你好' },
      ]);
    });
  });

  describe('stream passthrough', () => {
    it('emits OpenAI chunks and ends with [DONE]', async () => {
      const app = build(fixtureClient(streamFixture));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: {
          model: 'deepseek-v4.1-flash',
          messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Reply with OK only.' }],
          stream: true,
        },
      });
      expect(res.statusCode).toBe(200);
      const ct = res.headers['content-type'];
      expect(String(ct)).toContain('text/event-stream');
      const text = res.body;
      expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
      const frames = text
        .split('\n\n')
        .map((l) => l.replace(/^data: /, ''))
        .filter((l) => l && l !== '[DONE]')
        .map((l) => JSON.parse(l));
      // first frame carries role
      expect(frames[0].choices[0].delta).toEqual({ role: 'assistant' });
      // content delta frame
      const content = frames.map((f) => f.choices[0]?.delta?.content ?? '').join('');
      expect(content).toBe('OK');
      // finish frame: null finish earlier, stop at end, no shells
      const last = frames[frames.length - 1];
      expect(last.choices[0].finish_reason).toBe('stop');
      const joined = JSON.stringify(frames);
      expect(joined).not.toContain('reasoning_content":""');
      expect(joined).not.toContain('"function_call"');
      expect(joined).not.toContain('extra_fields');
    });

    it('forwards tool_calls increments and finishes with tool_calls', async () => {
      const app = build(fixtureClient(toolFixture));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: {
          model: 'deepseek-v4.1-flash',
          messages: [{ role: 'user', content: 'weather in Tokyo?' }],
          stream: true,
          tools: [
            { type: 'function', function: { name: 'get_weather', description: 'w', parameters: { type: 'object' } } },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const frames = res.body
        .split('\n\n')
        .map((l) => l.replace(/^data: /, ''))
        .filter((l) => l && l !== '[DONE]')
        .map((l) => JSON.parse(l));
      const toolFrames = frames.filter((f) => f.choices[0]?.delta?.tool_calls);
      expect(toolFrames.length).toBeGreaterThan(2);
      // first tool frame has id + name
      const first = toolFrames[0].choices[0].delta.tool_calls[0];
      expect(first.id).toMatch(/^call_/);
      expect(first.type).toBe('function');
      expect(first.function.name).toBe('get_weather');
      // continuation frames append arguments (fixture spells it {"city": "Tokyo"})
      const args = toolFrames
        .map((f) => f.choices[0].delta.tool_calls.map((tc: { function: { arguments: string } }) => tc.function.arguments).join(''))
        .join('');
      expect(JSON.parse(args)).toEqual({ city: 'Tokyo' });
      const last = frames[frames.length - 1];
      expect(last.choices[0].finish_reason).toBe('tool_calls');
    });

    it('emits a usage chunk when stream_options.include_usage is set', async () => {
      const app = build(fixtureClient(streamFixture));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: {
          model: 'deepseek-v4.1-flash',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
          stream_options: { include_usage: true },
        },
      });
      const frames = res.body
        .split('\n\n')
        .map((l) => l.replace(/^data: /, ''))
        .filter((l) => l && l !== '[DONE]')
        .map((l) => JSON.parse(l));
      const usageFrame = frames.find((f) => f.usage);
      expect(usageFrame).toBeDefined();
      expect(usageFrame.usage).toEqual({ prompt_tokens: 16, completion_tokens: 1, total_tokens: 17 });
      expect(usageFrame.choices).toEqual([]);
    });
  });

  describe('request validation', () => {
    let app: FastifyInstance;
    beforeAll(() => {
      app = build(fixtureClient(streamFixture));
    });

    it('rejects unknown model with 404 model_not_found', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: { model: 'gpt-99', messages: [{ role: 'user', content: 'x' }] },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('model_not_found');
      expect(res.json().error.param).toBe('model');
    });

    it('rejects max_tokens + max_completion_tokens together', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: {
          model: 'default-model',
          messages: [{ role: 'user', content: 'x' }],
          max_tokens: 5,
          max_completion_tokens: 6,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.type).toBe('invalid_request_error');
    });

    it('rejects semantics-changing unsupported params explicitly', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: { model: 'default-model', messages: [{ role: 'user', content: 'x' }], response_format: { type: 'json_object' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('unsupported_parameter');
    });

    it('rejects empty messages', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: { model: 'default-model', messages: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { 'content-type': 'application/json' },
        payload: { model: 'default-model', messages: [{ role: 'user', content: 'x' }] },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('upstream error mapping', () => {
    function errorClient(status: number, json: unknown): WorkBuddyClient {
      return new WorkBuddyClient({
        upstreamUrl: 'http://mock.local/v2/chat/completions',
        credentials: {
          getCredential: async () => ({ accessToken: 'mock', userId: 'mock', domain: 'www.workbuddy.ai' }),
          invalidate: () => {},
          describe: () => 'mock',
        } as never,
        userAgent: 'WorkBuddy/2.137.1',
        fetchFn: (async () => {
          return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
        }) as unknown as typeof fetch,
      });
    }

    it('maps upstream 401 to 502 upstream_authentication_error without retry loop', async () => {
      const app = build(errorClient(401, { code: 1000, msg: 'unauthorized' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: { model: 'default-model', messages: [{ role: 'user', content: 'x' }] },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe('upstream_authentication_error');
    });

    it('maps upstream quota 429 to insufficient_quota', async () => {
      const app = build(errorClient(429, { code: 1001, msg: 'quota exceeded' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: { model: 'default-model', messages: [{ role: 'user', content: 'x' }] },
      });
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('insufficient_quota');
    });

    it('maps upstream 500 to 502 upstream_error', async () => {
      const app = build(errorClient(500, { code: -1, msg: 'oops' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: { model: 'default-model', messages: [{ role: 'user', content: 'x' }] },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe('upstream_error');
    });

    it('surfaces upstream 4xx request errors as invalid_request with upstream message', async () => {
      const app = build(errorClient(400, { code: 11128, msg: 'first message is not system prompt' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        payload: { model: 'default-model', messages: [{ role: 'user', content: 'x' }] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('system prompt');
    });
  });
});
