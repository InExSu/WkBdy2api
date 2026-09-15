import { once } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { messagesSchema, MessagesInputError, normalizeAnthropicRequestBody, toWorkBuddyMessageRequest } from '../anthropic/request-mapper.js';
import { MessagesResponseBuilder } from '../anthropic/response-builder.js';
import { anthropicError, mapMessagesError } from '../anthropic/errors.js';
import { UpstreamProtocolError, type WorkBuddyClient, type StreamResult } from '../workbuddy/client.js';
import type { ExposedModel } from '../workbuddy/model-catalog.js';
import type { MetricsCollector } from '../observability/metrics.js';

type MessagesOptions = {
  models: ExposedModel[];
  client: WorkBuddyClient;
  metrics: MetricsCollector;
  modelAliases?: Record<string, string>;
};

export function messagesRoutes(app: FastifyInstance, opts: MessagesOptions): void {
  app.post('/messages/count_tokens', async (req, reply) => reply.code(501).send(
    anthropicError(501, 'Exact token counting is unavailable for the WorkBuddy upstream.', req.id),
  ));

  app.post('/messages', async (req, reply) => {
    const began = performance.now();
    let model: string | undefined;
    let streaming = false;
    let counted = false;
    let builder: MessagesResponseBuilder | undefined;
    const record = (status: number) => {
      if (counted) return;
      counted = true;
      opts.metrics.record({ method: 'POST', path: '/v1/messages', model, stream: streaming,
        status, duration_ms: Math.round(performance.now() - began),
        prompt_tokens: builder?.usage?.input_tokens, completion_tokens: builder?.usage?.output_tokens,
        ...(status >= 400 ? { error_code: 'messages_request_failed' } : {}),
      });
    };
    const fail = (status: number, message: string) => {
      record(status);
      return reply.code(status).send(anthropicError(status, message, req.id));
    };
    reply.header('request-id', req.id);
    const version = req.headers['anthropic-version'];
    if (version !== undefined && version !== '2023-06-01') return fail(400, 'Supported anthropic-version is 2023-06-01.');
    const parsed = messagesSchema.safeParse(normalizeAnthropicRequestBody(req.body));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join('.') || 'body';
      return fail(400, `Unsupported or invalid Messages parameter at ${path}${issue?.message ? `: ${issue.message}` : '.'}`);
    }
    const request = parsed.data;
    model = Object.prototype.hasOwnProperty.call(opts.modelAliases ?? {}, request.model) ? opts.modelAliases![request.model] : request.model;
    streaming = request.stream;
    const entry = opts.models.find((m) => m.id === model);
    if (!entry) return fail(404, 'Model not found. Use a gateway model ID or configure an explicit model alias.');
    if (entry.x_workbuddy.max_output_tokens && request.max_tokens > entry.x_workbuddy.max_output_tokens) return fail(400, 'max_tokens exceeds the configured model output limit.');
    if (request.tools?.length && entry.x_workbuddy.supports_tool_call === false) return fail(400, 'This model does not support tool calls.');
    if (entry.x_workbuddy.supports_images === false && request.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image'))) {
      return fail(400, 'This model does not support images.');
    }
    let upstream;
    try { upstream = toWorkBuddyMessageRequest(request, entry.id); }
    catch (err) {
      if (err instanceof MessagesInputError) return fail(400, err.message);
      return fail(400, 'Invalid Messages request.');
    }
    reply.header('x-wkbdy-upstream-model', entry.id);
    builder = new MessagesResponseBuilder(entry.id);
    const abort = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) abort.abort(); };
    reply.raw.on('close', onClose);
    let stream: StreamResult | undefined;
    let committed = false;
    const writeEvent = async (event: { type: string }) => {
      abort.signal.throwIfAborted();
      if (!reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) {
        await once(reply.raw, 'drain', { signal: abort.signal });
      }
    };
    try {
      stream = await opts.client.streamChatCompletion(upstream, abort.signal, true, true);
      if (!streaming) {
        for await (const chunk of stream) builder.push(chunk);
        builder.finish();
        const message = builder.build();
        record(200);
        return message;
      }
      // Await an actual upstream frame before committing a successful SSE status.
      const first = await stream.next();
      if (first.done) throw new UpstreamProtocolError('Upstream returned no content.');
      const initial = builder.push(first.value);
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no', 'request-id': req.id, 'x-wkbdy-upstream-model': entry.id,
      });
      committed = true;
      for (const event of initial) await writeEvent(event);
      for await (const chunk of stream) for (const event of builder.push(chunk)) await writeEvent(event);
      for (const event of builder.finish()) await writeEvent(event);
      record(200);
      reply.raw.end();
    } catch (err) {
      const failure = mapMessagesError(err);
      record(abort.signal.aborted ? 499 : failure.status);
      if (!reply.raw.destroyed && !abort.signal.aborted) {
        if (committed) {
          await writeEvent(anthropicError(failure.status, failure.message, req.id)).catch(() => {});
          reply.raw.end();
        } else {
          if (failure.retryAfter && /^(\d+|[A-Za-z]{3}, [\w ,:\-]+GMT)$/.test(failure.retryAfter)) reply.header('Retry-After', failure.retryAfter);
          return reply.code(failure.status).send(anthropicError(failure.status, failure.message, req.id));
        }
      }
    } finally {
      abort.abort();
      await stream?.return(undefined).catch(() => {});
      reply.raw.removeListener('close', onClose);
    }
    return reply;
  });
}
