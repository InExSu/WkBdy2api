import type { FastifyReply } from 'fastify';

// Keep slow upstream handshakes alive too. Errors before the first heartbeat
// retain their HTTP status; later failures must be sent as SSE error events.
export function prepareSse(reply: FastifyReply, headers: Record<string, string> = {}) {
  const response = reply.raw;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  response.setTimeout(0, () => {});

  const writeComment = () => {
    if (response.destroyed || response.writableEnded) { stop(); return; }
    if (!response.writableNeedDrain) response.write(': keep-alive\n\n');
  };
  const start = () => {
    clearTimeout(waiting);
    if (stopped || response.destroyed || response.writableEnded || response.headersSent) return;
    reply.hijack();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', ...headers,
    });
    response.flushHeaders?.();
    heartbeat = setInterval(writeComment, 15_000);
    heartbeat.unref();
  };
  const stop = () => {
    stopped = true;
    clearTimeout(waiting);
    clearInterval(heartbeat);
    response.removeListener('close', stop);
    response.removeListener('finish', stop);
  };
  const waiting = setTimeout(() => { start(); if (!stopped) writeComment(); }, 15_000);
  waiting.unref();
  response.once('close', stop);
  response.once('finish', stop);
  return { start, stop };
}
