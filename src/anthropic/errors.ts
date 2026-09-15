import { CredentialError } from '../workbuddy/auth.js';
import { UpstreamHttpError, UpstreamProtocolError } from '../workbuddy/client.js';

export function anthropicError(status: number, message: string, requestId: string) {
  const type = status === 400 || status === 413 ? 'invalid_request_error'
    : status === 401 ? 'authentication_error'
      : status === 403 ? 'permission_error'
        : status === 404 ? 'not_found_error'
          : status === 429 ? 'rate_limit_error'
            : status === 529 ? 'overloaded_error' : 'api_error';
  return { type: 'error' as const, error: { type, message }, request_id: requestId };
}

export function mapMessagesError(error: unknown): { status: number; message: string; retryAfter?: string } {
  if (error instanceof UpstreamHttpError) {
    if (error.status === 401 || error.status === 403) return { status: 502, message: 'WorkBuddy account authentication failed. Sign in again from the gateway panel.' };
    if (error.status === 429) return { status: 429, message: 'WorkBuddy rate limit or quota exceeded.', retryAfter: error.retryAfter };
    return { status: 502, message: `WorkBuddy request failed (HTTP ${error.status}).` };
  }
  if (error instanceof UpstreamProtocolError) return { status: 502, message: 'The upstream response could not be converted to a Messages response.' };
  if (error instanceof CredentialError) return { status: 503, message: 'No available WorkBuddy account. Sign in from the gateway panel.' };
  if (error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(error.message))) return { status: 504, message: 'WorkBuddy request timed out.' };
  if (error instanceof Error && error.name === 'AbortError') return { status: 499, message: 'Request cancelled.' };
  return { status: 500, message: 'Request could not be processed.' };
}
