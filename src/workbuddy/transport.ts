import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

// Dedicated transport: no fetch implementation's implicit header/body deadlines.
// Authentication redirects are deliberately not followed.
export const fetchUpstream: typeof fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported upstream protocol.');
  const signal = init.signal;
  signal?.throwIfAborted();
  const headers = Object.fromEntries(new Headers(init.headers));
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: init.method ?? 'GET', headers,
    });
    request.setTimeout(0);
    const aborted = () => {
      const reason = signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
      request.destroy(reason);
    };
    const cleanup = () => signal?.removeEventListener('abort', aborted);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
    request.once('error', (error) => { cleanup(); reject(error); });
    request.once('response', (response) => {
      response.setTimeout(0);
      response.once('close', cleanup);
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const status = response.statusCode ?? 502;
      if (status === 204 || status === 205 || status === 304 || init.method === 'HEAD') {
        response.resume();
        resolve(new Response(null, { status, headers: responseHeaders }));
      } else {
        resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      }
    });
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
      request.destroy();
      cleanup();
      reject(new Error('Upstream transport requires a JSON string body.'));
      return;
    }
    request.end(init.body ?? undefined);
  });
};
