import type { FastifyInstance, FastifyReply } from 'fastify';
import { chatRequestSchema, normalizeOpenAiRequestBody, toUpstreamRequest } from '../workbuddy/request-mapper.js';
import { WorkBuddyClient, UpstreamHttpError, UpstreamProtocolError, isChannelRejected, CHANNEL_REJECTED_MESSAGE } from '../workbuddy/client.js';
import { prepareSse } from './sse-keepalive.js';
import { CompletionAggregator, toOpenAiChunk, localCompletionId } from '../openai/response-builder.js';
import { openAiError, type ApiErrorCode } from '../openai/errors.js';
import type { ExposedModel } from '../workbuddy/model-catalog.js';
import type { CredentialPool } from '../workbuddy/credential-pool.js';
import type { MetricsCollector } from '../observability/metrics.js';

/** Fields that would silently change semantics if dropped; reject instead. */
const REJECTED_UNSUPPORTED = new Set([
  'logprobs',
  'top_logprobs',
  'response_format',
  'seed',
  'presence_penalty',
  'frequency_penalty',
  'n',
  'store',
  'metadata',
  'logit_bias',
  'functions',
  'function_call',
  'audio',
  'modalities',
  'prediction',
  'web_search_options',
  'service_tier',
  'speed',
]);

interface ChatOpts {
  models: ExposedModel[];
  client: WorkBuddyClient;
  pool: CredentialPool;
  metrics: MetricsCollector;
}

export function chatCompletionsRoutes(app: FastifyInstance, opts: ChatOpts): void {
  app.post('/chat/completions', async (req, reply) => {
    const startedAt = performance.now();
    const record = (entry: {
      status: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      error_code?: string;
    }) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      opts.metrics.record({
        method: 'POST',
        path: '/v1/chat/completions',
        status: entry.status,
        model: typeof body.model === 'string' ? body.model : undefined,
        stream: body.stream === true,
        duration_ms: Math.round(performance.now() - startedAt),
        prompt_tokens: entry.prompt_tokens,
        completion_tokens: entry.completion_tokens,
        error_code: entry.error_code,
      });
    };
    const body = normalizeOpenAiRequestBody(req.body) as Record<string, unknown>;
    // ---- validate ---------------------------------------------------------
    for (const key of Object.keys(body)) {
      if (REJECTED_UNSUPPORTED.has(key)) {
        const err = openAiError(400, 'unsupported_parameter', `Parameter '${key}' is not supported by this gateway.`, key);
        record({ status: 400, error_code: err.body.error.code });
        return reply.code(err.statusCode).send(err.body);
      }
    }
    if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) {
      const err = openAiError(
        400,
        'invalid_request',
        'max_tokens and max_completion_tokens are mutually exclusive.',
      );
      record({ status: 400, error_code: err.body.error.code });
      return reply.code(err.statusCode).send(err.body);
    }
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path.join('.') ?? '';
      const err = openAiError(
        400,
        'invalid_request',
        first ? `${path ? path + ': ' : ''}${first.message}` : 'Invalid request body.',
        path || null,
      );
      record({ status: 400, error_code: err.body.error.code });
      return reply.code(err.statusCode).send(err.body);
    }
    const request = parsed.data;
    const model = opts.models.find((m) => m.id === request.model);
    if (!model) {
      const err = openAiError(404, 'model_not_found', `Model '${request.model}' not found.`);
      record({ status: 404, error_code: 'model_not_found' });
      return reply.code(err.statusCode).send(err.body);
    }

    const contextLengths = model.x_workbuddy.context_window?.supportedLengths;
    const requestedContext = request.context_window ?? opts.pool.getContextWindow(request.model);
    const context_window = requestedContext !== undefined && contextLengths?.includes(requestedContext)
      ? requestedContext
      : contextLengths?.length ? Math.max(...contextLengths) : undefined;
    const upstreamBody = toUpstreamRequest({ ...request, context_window });
    const abort = new AbortController();
    // Node fires 'close' on the request stream once the body is consumed —
    // before the response is sent. Watch the response stream instead: it
    // closes early only when the client actually disconnects.
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) abort.abort();
    });

    // ---- non-stream: upstream stream + local aggregation -----------------
    if (!request.stream) {
      try {
        const stream = await opts.client.streamChatCompletion(upstreamBody, abort.signal);
        const agg = new CompletionAggregator();
        for await (const chunk of stream) agg.push(chunk);
        const built = agg.build(request.model);
        record({
          status: 200,
          prompt_tokens: built.usage?.prompt_tokens,
          completion_tokens: built.usage?.completion_tokens,
        });
        return built;
      } catch (err) {
        const mapped = mapUpstreamError(err);
        record({ status: mapped.statusCode, error_code: mapped.body.error.code });
        return reply.code(mapped.statusCode).send(mapped.body);
      } finally {
        abort.abort();
      }
    }

    // ---- stream: convert and forward frame by frame ----------------------
    let meta: { id: string; created: number; model: string };
    const sse = prepareSse(reply);
    let recordedStream = false;
    const recordStream = (status: number, usage?: { prompt_tokens?: number; completion_tokens?: number }, errorCode?: string) => {
      if (recordedStream) return;
      recordedStream = true;
      record({ status, prompt_tokens: usage?.prompt_tokens, completion_tokens: usage?.completion_tokens, error_code: errorCode });
    };
    try {
      const stream = await opts.client.streamChatCompletion(upstreamBody, abort.signal, true, true);
      sse!.start();
      meta = { id: localCompletionId(), created: Math.floor(Date.now() / 1000), model: request.model };
      const includeUsage = request.stream_options?.include_usage === true;
      let pendingUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
      for await (const chunk of stream) {
        // The usage-bearing frame is the finish frame; always forward its
        // finish_reason/delta, but hold the usage block for the optional chunk.
        if (chunk.usage) {
          if (includeUsage) {
            pendingUsage = {
              prompt_tokens: chunk.usage.prompt_tokens ?? 0,
              completion_tokens: chunk.usage.completion_tokens ?? 0,
              total_tokens: chunk.usage.total_tokens ?? 0,
            };
          }
          recordStream(200, pendingUsage ?? undefined);
          const usageOnlyChunk: typeof chunk = { ...chunk, usage: null };
          const converted = toOpenAiChunk(usageOnlyChunk, meta);
          if (converted) reply.raw.write(`data: ${JSON.stringify(converted)}\n\n`);
          continue;
        }
        const converted = toOpenAiChunk(chunk, meta);
        if (converted) reply.raw.write(`data: ${JSON.stringify(converted)}\n\n`);
      }
      recordStream(200, pendingUsage ?? undefined);
      if (pendingUsage) {
        reply.raw.write(
          `data: ${JSON.stringify({
            id: meta.id,
            object: 'chat.completion.chunk',
            created: meta.created,
            model: meta.model,
            choices: [],
            usage: {
              prompt_tokens: pendingUsage.prompt_tokens ?? 0,
              completion_tokens: pendingUsage.completion_tokens ?? 0,
              total_tokens: pendingUsage.total_tokens ?? 0,
            },
          })}\n\n`,
        );
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    } catch (err) {
      const mapped = mapUpstreamError(err);
      recordStream(abort.signal.aborted ? 499 : mapped.statusCode, undefined, mapped.body.error.code);
      if (!reply.raw.headersSent) return reply.code(mapped.statusCode).send(mapped.body);
      if (!reply.raw.destroyed && !abort.signal.aborted) {
        reply.raw.write(`data: ${JSON.stringify({ error: mapped.body.error })}\n\n`);
        reply.raw.end();
      }
    } finally {
      sse.stop();
      abort.abort();
    }
    return reply;
  });
}

function sendUpstreamError(reply: FastifyReply, err: unknown) {
  const mapped = mapUpstreamError(err);
  return reply.code(mapped.statusCode).send(mapped.body);
}

export function mapUpstreamError(err: unknown): ReturnType<typeof openAiError> {
  if (isChannelRejected(err)) return openAiError(403, 'upstream_channel_rejected', CHANNEL_REJECTED_MESSAGE);
  if (err instanceof UpstreamHttpError) {
    switch (err.status) {
      case 401:
      case 403:
        return openAiError(
          502,
          'upstream_authentication_error',
          'Upstream WorkBuddy credentials were rejected. Re-login to the WorkBuddy app or update the mounted token file.',
        );
      case 429: {
        const quota = /quota|credit|limit/i.test(err.upstreamMessage);
        return openAiError(
          429,
          quota ? 'insufficient_quota' : 'rate_limit_exceeded',
          'Upstream rate limit or quota exceeded.',
        );
      }
      case 404:
        return openAiError(502, 'upstream_error', 'Upstream endpoint not found (protocol drift?).');
      default:
        if (err.status >= 500) {
          return openAiError(502, 'upstream_error', `Upstream server error (HTTP ${err.status}).`);
        }
        // 4xx from upstream = the gateway translated the request badly, or the
        // request content was rejected. Surface as invalid_request with upstream msg.
        return openAiError(
          400,
          'invalid_request',
          `Upstream rejected the request: ${err.upstreamMessage || `HTTP ${err.status}`}`,
        );
    }
  }
  if (err instanceof UpstreamProtocolError) {
    return openAiError(502, 'upstream_protocol_error', err.message);
  }
  if (err instanceof Error && /timeout/i.test(err.message)) {
    return openAiError(504, 'upstream_timeout', 'Upstream request timed out.');
  }
  if (err instanceof Error && err.name === 'AbortError') {
    // client went away before we could respond
    return openAiError(499, 'invalid_request', 'Request aborted by client.');
  }
  return openAiError(500, 'internal_error', 'Request could not be processed.');
}
