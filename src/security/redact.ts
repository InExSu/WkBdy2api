/**
 * Recursive redaction for structured logs. Keys are matched case-insensitively
 * against a sensitive-key set; values are replaced wholesale, never logged.
 * Arrays and nested objects are traversed; cycles are tolerated.
 */

const SENSITIVE_KEYS = new Set(
  [
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'api-key',
    'x-api-key',
    'x-user-id',
    'token',
    'accesstoken',
    'refreshtoken',
    'x-refresh-token',
    'authurl',
    'authorization_url',
    'officialstate',
    'state',
    'accesstokentype',
    'session',
    'secret',
    'password',
    'apikey',
  ].map((k) => k.toLowerCase()),
);
const SENSITIVE_SNAKE = new Set(['access_token', 'refresh_token', 'api_key', 'user_id']);

const REDACTED = '[REDACTED]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CYCLE]';
    seen.add(value);
    return value.map((v) => redact(v, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[CYCLE]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      out[k] =
        SENSITIVE_KEYS.has(lower) || SENSITIVE_SNAKE.has(k) ? REDACTED : redact(v, seen);
    }
    return out;
  }
  return value;
}
