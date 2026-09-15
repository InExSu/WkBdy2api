import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OAuthBroker, OAuthError } from '../workbuddy/oauth-broker.js';

const COOKIE = 'wkb-oauth-browser';
const idSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{32}$/) });
const startSchema = z.object({ note: z.string().trim().max(64).optional() }).strict();
const browserSession = (req: FastifyRequest): string | undefined => {
  const value = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{32}$/.test(value) ? value : undefined;
};

export function oauthRoutes(app: FastifyInstance, opts: { broker: OAuthBroker }): void {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    if (req.method === 'GET') return;
    try {
      const origin = new URL(req.headers.origin ?? '');
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host || origin.origin !== req.headers.origin) throw new Error();
    } catch {
      return reply.code(403).send({ error: { code: 'oauth_invalid_origin', message: '请从管理面板发起登录。' } });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    const known = err instanceof OAuthError;
    const malformed = !known && (err as { statusCode?: number }).statusCode === 400;
    reply.code(known ? err.statusCode : malformed ? 400 : 500).send({
      error: { code: known ? err.code : malformed ? 'oauth_invalid_request' : 'oauth_internal_error', message: '登录未完成，请重试或检查网关网络。' },
    });
  });

  app.post('/start', async (req, reply) => {
    const input = startSchema.safeParse(req.body ?? {});
    if (!input.success) throw new OAuthError(400, 'oauth_invalid_request');
    let owner = browserSession(req);
    if (!owner) {
      owner = randomBytes(24).toString('base64url');
      const secure = req.headers.origin?.startsWith('https://') ? '; Secure' : '';
      reply.header('Set-Cookie', `${COOKIE}=${owner}; Path=/admin/api/oauth; HttpOnly; SameSite=Strict; Max-Age=3600${secure}`);
    }
    return opts.broker.start(owner, input.data.note);
  });

  app.get('/:id/status', async (req) => {
    const input = idSchema.safeParse(req.params);
    const owner = browserSession(req);
    if (!input.success || !owner) throw new OAuthError(404, 'oauth_session_not_found');
    return opts.broker.status(input.data.id, owner);
  });

  app.post('/:id/cancel', async (req) => {
    const input = idSchema.safeParse(req.params);
    const owner = browserSession(req);
    if (!input.success || !owner) throw new OAuthError(404, 'oauth_session_not_found');
    return opts.broker.cancel(input.data.id, owner);
  });
}
