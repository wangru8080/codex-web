/**
 * Unified API error response helpers.
 *
 * `serverErrorResponse` logs the full error (stack included) to the server
 * console for diagnosis, but returns ONLY the human-readable message to the
 * client — never the stack trace, which leaks absolute file paths and internal
 * structure. Introduced for audit task A1 (see
 * docs/exec-plans/active/codebase-health-audit-2026-06.md); intended as the
 * single 500-response exit point that future routes adopt (audit task D5).
 */

/** Extract a client-safe message from an unknown thrown value (never a stack). */
export function toClientErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Log `error` (with stack, under `scope`) to the server console, then return a
 * JSON response (default 500) whose body is `{ error: <message only> }`.
 *
 * The stack stays server-side; the client only ever sees the message.
 */
export function serverErrorResponse(
  scope: string,
  error: unknown,
  status = 500,
): Response {
  const logDetail =
    error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[${scope}] Error:`, logDetail);
  return Response.json({ error: toClientErrorMessage(error) }, { status });
}
