/**
 * Phase 7 (2026-05-20) — Codex Runtime provider-backend resolution.
 *
 * Originally housed `produceCodexAccountingSnapshot` (Phase 4 producer);
 * that producer is replaced by `collectAutoInvokeSnapshot` from
 * auto-invoke-accounting.ts (real tool_use scan vs rules-only guess), so
 * this module's surface is reduced to just the backend resolver helper.
 */

export type CodexProviderBackend = 'codex_account' | 'codepilot_proxy' | 'native_app_server';

/**
 * Resolve provider backend from runtime input. `providerId === 'codex_account'`
 * → codex_account; everything else through Codex runtime → codepilot_proxy
 * (because the bridge layer routes user-supplied providers via CodexWeb).
 * 'native_app_server' is reserved for future direct-SDK integration.
 */
export function resolveCodexProviderBackend(providerId: string): CodexProviderBackend {
  if (providerId === 'codex_account') return 'codex_account';
  return 'codepilot_proxy';
}
