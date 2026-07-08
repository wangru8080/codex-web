/**
 * Runtime identifier — the canonical machine label for any Agent
 * Runtime registered with CodexWeb.
 *
 * Slice A of Phase 0.5 (Runtime Contract Hardening, 2026-05-13) — this
 * file is the one place to add a new runtime id. The string-literal
 * union is consumed by:
 *
 *   - `RuntimeSessionRef.runtimeId` (adapter-owned session metadata)
 *   - `RuntimeRunEvent` / `RuntimePermissionEvent` (internal event union)
 *   - `ModelRuntimeCompat.supportedRuntimes` (model compat matrix)
 *   - `ChatRuntime` (legacy alias for backward compat — same values)
 *
 * Codex Runtime is intentionally NOT in `RUNTIME_IDS` yet — adding it
 * is a Phase 5 deliverable. Slice A only lays the foundation; the
 * Codex integration slices add 'codex_runtime' to this array in one
 * atomic change that propagates through every consumer at once.
 */

export const RUNTIME_IDS = ['claude_code', 'codepilot_runtime', 'codex_runtime'] as const;

export type RuntimeId = (typeof RUNTIME_IDS)[number];

export function isRuntimeId(v: unknown): v is RuntimeId {
  return typeof v === 'string' && (RUNTIME_IDS as readonly string[]).includes(v);
}

/**
 * Wire form for HTTP query params — adds 'auto' (server resolves).
 * Kept here so transport code can validate inputs against a single
 * source of truth.
 */
export type RuntimeIdParam = RuntimeId | 'auto';

export function isRuntimeIdParam(v: unknown): v is RuntimeIdParam {
  return v === 'auto' || isRuntimeId(v);
}
