import { SseParser } from './stream-parser.js';
import type { UpstreamChatRequest } from './request-mapper.js';
import type { WorkBuddyCredential } from './auth.js';
import { fetchUpstream } from './transport.js';

export type UpstreamDiagnostic = {
  phase: 'headers' | 'end';
  result: 'ok' | 'http_error' | 'channel_rejected' | 'transport_error' | 'protocol_error' | 'client_cancelled';
  account: string;
  credential_source: 'oauth' | 'imported';
  model: string;
  duration_ms: number;
  status?: number;
  upstream_code?: string;
};

/** One normalized upstream chunk event, post-SSE parsing. */
export type UpstreamChunk = {
  id?: string;
  model?: string;
  created?: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason: string | null; // upstream uses '' for "in progress"
  usage: UpstreamUsage | null;
};

export type UpstreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type StreamResult = AsyncGenerator<UpstreamChunk, void, void>;

export type ClientOptions = {
  upstreamUrl: string;
  credentials: CredentialLike;
  userAgent: string;
  fetchFn?: typeof fetch;
  onDiagnostic?: (event: UpstreamDiagnostic) => void;
};

/**
 * Credential surface the client needs. CredentialProvider (single) and
 * CredentialPool (multi) both satisfy it; the pool additionally accepts
 * failure reports so a dead account can be quarantined.
 */
export type CredentialLike = {
  getCredential(): Promise<WorkBuddyCredential>;
  invalidate(): void;
  describe(): string;
  reportFailure?(token: string): void;
  accountLabel?(credential: WorkBuddyCredential): string | undefined;
  refreshRejectedCredential?(credential: WorkBuddyCredential): Promise<WorkBuddyCredential>;
};

/** Upstream 4xx/5xx surfaced as a typed error with the upstream status. */
export class UpstreamHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly upstreamMessage: string,
    public readonly retryAfter?: string,
  ) {
    super(`upstream ${status}`);
    this.name = 'UpstreamHttpError';
  }
}

export class UpstreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamProtocolError';
  }
}

export const CHANNEL_REJECTED_MESSAGE = 'WorkBuddy rejected this account or integration channel. Check account authorization with WorkBuddy; the gateway will not retry through another account.';
export function isChannelRejected(error: unknown): error is UpstreamHttpError {
  return error instanceof UpstreamHttpError && /unapproved channel/i.test(error.upstreamMessage);
}

export class WorkBuddyClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetchUpstream;
  }

  async streamChatCompletion(
    body: UpstreamChatRequest,
    signal: AbortSignal,
    allowAuthRetry = true,
    requireDone = false,
  ): Promise<StreamResult> {
    const began = performance.now();
    let credential = await this.opts.credentials.getCredential();
    const report = (phase: UpstreamDiagnostic['phase'], result: UpstreamDiagnostic['result'], status?: number, code?: string) => {
      this.opts.onDiagnostic?.({ phase, result, status,
        ...(code && /^\d{1,10}$/.test(code) ? { upstream_code: code } : {}),
        account: this.opts.credentials.accountLabel?.(credential) ?? 'unlabelled',
        credential_source: credential.oauthOrigin ? 'oauth' : 'imported',
        model: body.model, duration_ms: Math.round(performance.now() - began),
      });
    };
    try {
      let res = await this.attempt(body, signal, credential);
      if (res.status === 401 && allowAuthRetry) {
        await res.body?.cancel().catch(() => {});
        if (this.opts.credentials.refreshRejectedCredential) {
          try { credential = await this.opts.credentials.refreshRejectedCredential(credential); }
          catch { throw new UpstreamHttpError(401, undefined, 'Account needs a new web login.'); }
        } else {
          this.opts.credentials.invalidate();
          credential = await this.opts.credentials.getCredential();
        }
        res = await this.attempt(body, signal, credential);
      }
      if (res.status === 401 || res.status === 403) this.opts.credentials.reportFailure?.(credential.accessToken);
      if (res.status !== 200 || !res.body) {
        const text = await res.text().catch(() => '');
        const parsed = safeJson(text);
        throw new UpstreamHttpError(res.status, parsed?.code !== undefined ? String(parsed.code) : undefined,
          typeof parsed?.msg === 'string' ? parsed.msg : text.slice(0, 500), res.headers.get('retry-after') ?? undefined);
      }
      report('headers', 'ok', res.status);
      const parsedStream = this.parseStream(res.body, signal, requireDone);
      return (async function* () {
        let completed = false;
        try {
          yield* parsedStream;
          completed = true;
          report('end', 'ok', 200);
        } catch (error) {
          report('end', signal.aborted ? 'client_cancelled' : isChannelRejected(error) ? 'channel_rejected' : error instanceof UpstreamProtocolError ? 'protocol_error' : 'transport_error',
            error instanceof UpstreamHttpError ? error.status : undefined, error instanceof UpstreamHttpError ? error.code : undefined);
          throw error;
        } finally {
          if (!completed) await parsedStream.return(undefined).catch(() => {});
        }
      })();
    } catch (error) {
      report('end', signal.aborted ? 'client_cancelled' : isChannelRejected(error) ? 'channel_rejected'
        : error instanceof UpstreamHttpError ? 'http_error' : 'transport_error',
      error instanceof UpstreamHttpError ? error.status : undefined, error instanceof UpstreamHttpError ? error.code : undefined);
      throw error;
    }
  }

  /**
   * Verify a candidate credential against the upstream before the admin
   * panel switches to it. Minimal request: one user message, one token of
   * expected output. Throws UpstreamHttpError on rejection — caller maps it.
   * Does NOT touch the provider's active credential.
   */
  async verifyCredential(cred: { accessToken: string; userId: string }): Promise<void> {
    const domain = 'www.workbuddy.ai';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${cred.accessToken}`,
      'X-User-Id': cred.userId,
      'X-Domain': domain,
      'X-Product': 'SaaS',
      'User-Agent': this.opts.userAgent,
    };
    const body: UpstreamChatRequest = {
      model: 'deepseek-v4.1-flash',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Reply with OK only.' },
      ],
      stream: true,
      max_tokens: 5,
    };
    const res = await this.fetchFn(this.opts.upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    // Consume/discard whatever came back so the socket is released.
    await res.body?.cancel().catch(() => {});
    if (res.status === 200) return;
    const text = await res.text().catch(() => '');
    const parsed = safeJson(text);
    throw new UpstreamHttpError(
      res.status,
      parsed?.code !== undefined ? String(parsed.code) : undefined,
      typeof parsed?.msg === 'string' ? parsed.msg : text.slice(0, 300),
    );
  }

  private async attempt(body: UpstreamChatRequest, signal: AbortSignal, cred: WorkBuddyCredential): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${cred.accessToken}`,
      'X-User-Id': cred.userId,
      'X-Domain': cred.domain,
      'X-Product': 'SaaS',
      'User-Agent': this.opts.userAgent,
    };
    return this.fetchFn(this.opts.upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  }

  /** Decode the SSE byte stream into normalized chunks. */
  private async *parseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, requireDone = false): StreamResult {
    const reader = body.getReader();
    const onAbort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    const decoder = new TextDecoder('utf-8');
    const parser = new SseParser();
    let done = false;
    try {
      while (!done) {
        signal.throwIfAborted();
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (frame.kind === 'done') {
            done = true;
            break;
          }
          if (frame.kind === 'comment') continue;
          const chunk = safeJson(frame.json);
          if (chunk === null) {
            throw new UpstreamProtocolError(`upstream sent a non-JSON SSE frame: ${frame.json.slice(0, 200)}`);
          }
          const message = typeof chunk.msg === 'string' ? chunk.msg : typeof chunk.error?.message === 'string' ? chunk.error.message : '';
          if (/unapproved channel/i.test(message)) throw new UpstreamHttpError(400, String(chunk.code ?? ''), message);
          yield normalizeChunk(chunk);
        }
      }
      if (!done) {
        // EOF before [DONE]: tolerate trailing frames, but note them.
        for (const frame of parser.flush()) {
          if (frame.kind === 'done') {
            done = true;
            break;
          }
          if (frame.kind === 'comment') continue;
          const chunk = safeJson(frame.json);
          if (chunk === null) throw new UpstreamProtocolError('upstream sent a non-JSON trailing frame');
          const message = typeof chunk.msg === 'string' ? chunk.msg : typeof chunk.error?.message === 'string' ? chunk.error.message : '';
          if (/unapproved channel/i.test(message)) throw new UpstreamHttpError(400, String(chunk.code ?? ''), message);
          yield normalizeChunk(chunk);
        }
      }
      signal.throwIfAborted();
      if (requireDone && !done) throw new UpstreamProtocolError('Upstream stream ended without [DONE].');
    } finally {
      signal.removeEventListener('abort', onAbort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

/** Map a raw upstream chunk JSON onto UpstreamChunk, tolerating shape drift. */
function normalizeChunk(raw: unknown): UpstreamChunk {
  const obj = (raw ?? {}) as Record<string, any>;
  const choice = obj.choices?.[0] ?? {};
  const delta = choice.delta ?? {};
  const finishRaw = choice.finish_reason;
  return {
    id: typeof obj.id === 'string' ? obj.id : undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
    created: typeof obj.created === 'number' ? obj.created : undefined,
    delta: {
      role: typeof delta.role === 'string' ? delta.role : undefined,
      content: typeof delta.content === 'string' ? delta.content : undefined,
      reasoning_content: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined,
      tool_calls: Array.isArray(delta.tool_calls) ? delta.tool_calls : undefined,
    },
    finish_reason: typeof finishRaw === 'string' && finishRaw !== '' ? finishRaw : null,
    usage: obj.usage && typeof obj.usage === 'object' && obj.usage.prompt_tokens !== undefined
      ? {
          prompt_tokens: obj.usage.prompt_tokens,
          completion_tokens: obj.usage.completion_tokens,
          total_tokens: obj.usage.total_tokens,
        }
      : null,
  };
}

function safeJson(text: string): Record<string, any> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
