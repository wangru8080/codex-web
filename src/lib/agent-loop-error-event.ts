import type { RuntimeContextAccountingSnapshot } from '@/types';

/**
 * Data payload for the Native runtime `error` SSE event.
 *
 * `context_accounting` mirrors the field the success-path `result` event
 * carries: an error-terminated turn still consumed context for whatever tool
 * calls ran before the throw, so when a snapshot is available the UI can still
 * report that usage. Omitted entirely when no snapshot could be produced, which
 * keeps the legacy `{ category, userMessage }` shape for the common case.
 */
export interface NativeErrorEventData {
  category: 'AGENT_ERROR';
  userMessage: string;
  context_accounting?: RuntimeContextAccountingSnapshot;
}

/**
 * Build the Native runtime error-event data. Pure (no I/O) so it is unit
 * testable without driving the agent-loop stream — which depends on
 * DB/streaming infrastructure and can't run in a pure unit context. (audit A3)
 *
 * @param err        the thrown value (Error → its message; otherwise String()).
 * @param accounting optional context-accounting snapshot; attached only when
 *                   present so a normal (no-snapshot) error keeps the legacy
 *                   `{ category, userMessage }` shape.
 */
export function buildNativeErrorEventData(
  err: unknown,
  accounting?: RuntimeContextAccountingSnapshot,
): NativeErrorEventData {
  return {
    category: 'AGENT_ERROR',
    userMessage: err instanceof Error ? err.message : String(err),
    ...(accounting ? { context_accounting: accounting } : {}),
  };
}
