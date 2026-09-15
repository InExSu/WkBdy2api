import { timingSafeEqual } from 'node:crypto';

/**
 * Downstream API key check. Constant-time comparison; the key never appears
 * in logs or error messages.
 */
export function isApiKeyValid(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
