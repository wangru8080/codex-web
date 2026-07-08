/**
 * Runtime session reference store — Phase 0.5 Slice C (2026-05-13).
 *
 * Each runtime adapter owns its own session-side state. Today:
 *
 *   - `claude_code`        — backed by `chat_sessions.sdk_session_id`
 *                            column (legacy, preserved for back-compat
 *                            with v0.x history rows).
 *   - `codepilot_runtime`  — no external session state.
 *   - future `codex_runtime` — will add its own persistence (likely a
 *                              JSON `runtime_session_metadata` column
 *                              or a dedicated `runtime_session_refs`
 *                              table). The switch cases below grow
 *                              with each new runtime.
 *
 * UI / API code should call these helpers instead of reading
 * `session.sdk_session_id` directly. That keeps adapter-specific
 * fields scoped to this file so adding Codex Runtime later doesn't
 * mean splaying `codex_thread_id` across the chat / preview / panel
 * code paths.
 *
 * Cross-runtime invariant (codified in runtime-session-metadata.test.ts):
 * runtime switching on a chat session must NOT delete the metadata
 * of OTHER runtimes — only the runtime being switched out (or in)
 * has its ref touched. Today this is trivially true because each
 * runtime has its own backing column / table; the Codex slice will
 * add `clearRuntimeSessionRef` calls scoped per-runtime, not a global
 * "clear everything" sweep.
 */

import type { RuntimeId } from './runtime-id';
import type { RuntimeSessionRef } from './contract';
import { getSession, updateSdkSessionId, updateCodexThreadId } from '@/lib/db';

/**
 * Resolve the runtime-side session reference for a chat session
 * under a given runtime. Returns null when no session has been
 * established yet (e.g. fresh chat, or runtime that doesn't track
 * external state).
 */
export function getRuntimeSessionRef(
  chatSessionId: string,
  runtimeId: RuntimeId,
): RuntimeSessionRef | null {
  switch (runtimeId) {
    case 'claude_code': {
      const session = getSession(chatSessionId);
      if (!session?.sdk_session_id) return null;
      return { runtimeId: 'claude_code', token: session.sdk_session_id };
    }
    case 'codepilot_runtime':
      // Native runtime keeps state in-memory in the runtime singleton.
      // No persistent ref to surface.
      return null;
    case 'codex_runtime': {
      // Phase 5 Phase 3 (2026-05-13) — Codex thread id persistence.
      // Backed by `chat_sessions.codex_thread_id` column. Codex's
      // `thread/resume` requires the original threadId, so we
      // persist it per chat session for cross-reload resume.
      //
      // Phase 5b (2026-05-15) — also returns the provider id the
      // thread was bound to via `metadata.providerId`. CodexRuntime
      // compares this to the current request's provider; on mismatch
      // it clears the ref and starts fresh instead of resuming under
      // a wrong provider's injected proxy config.
      const session = getSession(chatSessionId);
      if (!session?.codex_thread_id) return null;
      return {
        runtimeId: 'codex_runtime',
        token: session.codex_thread_id,
        metadata: {
          providerId: session.codex_thread_provider_id ?? '',
          // Phase 8 Phase 2 — MCP config fingerprint the thread was started
          // with. Empty when no MCP was injected (legacy / non-assistant).
          mcpConfigFingerprint: session.codex_thread_mcp_fingerprint ?? '',
          ...(session.codex_home_session_id ? { origin: 'codex_home' as const } : {}),
        },
      };
    }
    default: {
      // Exhaustiveness — when a new RuntimeId lands here, TS will fail
      // compilation forcing the implementer to add a case.
      const _: never = runtimeId;
      throw new Error(`getRuntimeSessionRef: unknown runtime ${String(_)}`);
    }
  }
}

/**
 * Persist the runtime-side session reference. Adapter is expected to
 * pass a `RuntimeSessionRef` whose `runtimeId` matches its own.
 */
export function setRuntimeSessionRef(
  chatSessionId: string,
  ref: RuntimeSessionRef,
): void {
  switch (ref.runtimeId) {
    case 'claude_code':
      updateSdkSessionId(chatSessionId, ref.token);
      return;
    case 'codepilot_runtime':
      // No-op — native runtime has no persistent ref.
      return;
    case 'codex_runtime': {
      // Phase 5 Phase 3 (2026-05-13) — persist Codex thread id.
      // Phase 5b (2026-05-15) — also persist the provider id the
      // thread was bound to so a later resume can detect a provider
      // switch and start fresh rather than running under a stale
      // proxy injection. Adapters MUST pass providerId in metadata
      // for codex_runtime refs; missing metadata falls back to ''
      // which means "unknown provider — always treat resume as stale".
      const providerId =
        typeof ref.metadata?.providerId === 'string' ? ref.metadata.providerId : '';
      // Phase 8 Phase 2 — persist the MCP config fingerprint so a later
      // resume can detect an MCP-config change and start fresh.
      const mcpFingerprint =
        typeof ref.metadata?.mcpConfigFingerprint === 'string'
          ? ref.metadata.mcpConfigFingerprint
          : '';
      updateCodexThreadId(chatSessionId, ref.token, providerId, mcpFingerprint);
      return;
    }
    default: {
      const _: never = ref.runtimeId;
      throw new Error(`setRuntimeSessionRef: unknown runtime ${String(_)}`);
    }
  }
}

/**
 * Clear the runtime-side session reference for one specific runtime.
 * Used when provider / model / runtime pin changes invalidate the
 * resume context (e.g. swapping the provider mid-session would let an
 * old SDK session id leak into a different provider).
 *
 * Only the named runtime's ref is touched — other runtimes' refs (if
 * any) are preserved. This is the cross-runtime metadata invariant.
 */
export function clearRuntimeSessionRef(
  chatSessionId: string,
  runtimeId: RuntimeId,
): void {
  switch (runtimeId) {
    case 'claude_code':
      updateSdkSessionId(chatSessionId, '');
      return;
    case 'codepilot_runtime':
      // No-op — nothing persisted.
      return;
    case 'codex_runtime':
      // Phase 5 Phase 3 (2026-05-13) — clear the persisted Codex
      // thread id. Provider / model / runtime-pin changes that
      // invalidate the resume context call this path scoped to
      // codex_runtime; other runtimes' refs stay intact. Phase 5b
      // also clears the bound provider id so the next start writes
      // a fresh pair. Phase 8 Phase 2 — also clears the MCP fingerprint.
      updateCodexThreadId(chatSessionId, '', '', '');
      return;
    default: {
      const _: never = runtimeId;
      throw new Error(`clearRuntimeSessionRef: unknown runtime ${String(_)}`);
    }
  }
}
