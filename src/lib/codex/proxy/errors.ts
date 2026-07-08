/**
 * Phase 5b — Structured error helpers for the Codex Responses proxy.
 *
 * Two surfaces every adapter / route writer hits:
 *
 *   makeErrorResult(code, message, context)
 *     Build a ProxyErrorResult. The route file maps it to either an
 *     SSE `response.failed` event (when the inbound request had
 *     stream:true) or a JSON 4xx/5xx body (when stream:false).
 *
 *   classifyUpstreamError(err)
 *     Best-effort classifier for errors raised by ai-sdk's
 *     `streamText` / `generateText` (which the adapter calls under
 *     the hood). Returns a ResponsesErrorCode + suggested HTTP status.
 *     Used when the underlying provider returns 4xx/5xx, the
 *     connection times out, etc.
 *
 * The adapter MUST go through one of these — never throw raw — so
 * Codex's HTTP client sees a deterministic envelope instead of a
 * Next.js generic error page.
 */

import type {
  ProxyErrorResult,
  ResponsesErrorCode,
  ResponsesErrorPayload,
} from './types';

const DEFAULT_STATUS_BY_CODE: Record<ResponsesErrorCode, number> = {
  invalid_request: 400,
  provider_not_targeted: 400,
  provider_not_found: 404,
  credentials_missing: 401,
  adapter_not_implemented: 501,
  upstream_client_error: 502,
  upstream_unauthorized: 401,
  upstream_rate_limited: 429,
  upstream_server_error: 502,
  upstream_timeout: 504,
  unknown_tool: 400,
  unsupported_tool_kind: 400,
  internal_error: 500,
};

export function makeErrorResult(
  code: ResponsesErrorCode,
  message: string,
  context?: Record<string, unknown>,
  statusOverride?: number,
): ProxyErrorResult {
  return {
    kind: 'error',
    status: statusOverride ?? DEFAULT_STATUS_BY_CODE[code],
    error: {
      code,
      message,
      ...(context ? { context } : {}),
    },
  };
}

/**
 * Map an arbitrary upstream error into a structured ResponsesErrorPayload.
 *
 * ai-sdk wraps provider HTTP failures in `APICallError` (and similar
 * subclasses) carrying `statusCode` and `responseBody`. Network /
 * abort errors come through as `AbortError` or vanilla Error. The
 * classifier is intentionally narrow — anything we don't recognise
 * lands in `internal_error` with the raw message + a `cause` context
 * so the user can still see what happened.
 */
export function classifyUpstreamError(
  err: unknown,
): { code: ResponsesErrorCode; message: string; context?: Record<string, unknown> } {
  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message;
    const anyErr = err as unknown as Record<string, unknown>;
    const statusCode = typeof anyErr.statusCode === 'number' ? (anyErr.statusCode as number) : undefined;
    const responseBody = anyErr.responseBody;

    if (name === 'AbortError' || /\baborted?\b/i.test(msg)) {
      // Codex closing the connection — surface as cancelled, not as
      // an error from the user's perspective. Adapter still wraps
      // this in a `response.failed` event because Codex's reader
      // doesn't have a "cancelled" event class today.
      return { code: 'upstream_timeout', message: 'Request aborted by client', context: { name } };
    }

    if (typeof statusCode === 'number') {
      const ctx: Record<string, unknown> = { statusCode };
      if (responseBody) ctx.responseBody = String(responseBody).slice(0, 1024);
      if (statusCode === 401 || statusCode === 403) {
        return { code: 'upstream_unauthorized', message: `Upstream authentication failed (HTTP ${statusCode}). ${msg}`, context: ctx };
      }
      if (statusCode === 429) {
        return { code: 'upstream_rate_limited', message: `Upstream rate limit / quota reached (HTTP 429). ${msg}`, context: ctx };
      }
      if (statusCode >= 400 && statusCode < 500) {
        return { code: 'upstream_client_error', message: `Upstream client error (HTTP ${statusCode}). ${msg}`, context: ctx };
      }
      if (statusCode >= 500) {
        return { code: 'upstream_server_error', message: `Upstream server error (HTTP ${statusCode}). ${msg}`, context: ctx };
      }
    }

    if (/timed?\s*out|timeout|ETIMEDOUT/i.test(msg)) {
      return { code: 'upstream_timeout', message: msg, context: { name } };
    }

    // Credential-shaped errors raised before reaching the wire.
    if (/credentials?\s+(missing|not\s+found|unavailable)|no\s+api\s+key/i.test(msg)) {
      return { code: 'credentials_missing', message: msg, context: { name } };
    }

    return { code: 'internal_error', message: msg, context: { name } };
  }

  return { code: 'internal_error', message: String(err) };
}

/**
 * Build the JSON body sent back to Codex when the request wasn't a
 * stream. Codex's reader looks for `error` at the top level when
 * `status === 'failed'` or when the HTTP status is 4xx/5xx.
 */
export function toNonStreamErrorBody(payload: ResponsesErrorPayload): { error: ResponsesErrorPayload } {
  return { error: payload };
}
