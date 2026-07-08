/**
 * Codex app-server reasoning-effort compatibility.
 *
 * The Codex app-server accepts only `minimal | low | medium | high` for
 * `model_reasoning_effort` (config) and the `turn/start` effort override.
 * CodexWeb's universal effort union (`RuntimeStreamOptions.effort`,
 * `src/lib/runtime/types.ts`) adds `xhigh` / `max` for Anthropic Opus
 * 4.7 / 4.8 tiers.
 *
 * Older / stricter codex builds REJECT unknown variants FATALLY — observed
 * 2026-05-31 with `/opt/homebrew/bin/codex`:
 *   `Failed to deserialize overridden config: unknown variant `xhigh``
 * and even codex 0.133 only tolerates them with a warning (falls back to
 * `medium`). So the `codex_runtime` `turn/start` path must never forward
 * the Opus-only tiers to Codex.
 *
 * Scope: codex_runtime ONLY. Claude Code / Native runtimes keep the full
 * union for Anthropic models — do NOT route their effort through here.
 *
 * Root-cause + POC: docs/research/packaged-preview-runtime-diagnosis-2026-05-31.md
 */

/** Reasoning-effort levels the Codex app-server accepts. */
export const CODEX_SUPPORTED_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;

export type CodexEffort = (typeof CODEX_SUPPORTED_EFFORTS)[number];

/**
 * Clamp CodexWeb's universal effort to a Codex-accepted value, for the
 * codex_runtime turn/start path.
 *
 * - `xhigh` / `max`            → `high`  (Opus-only tiers Codex doesn't know)
 * - `minimal`/`low`/`medium`/`high` → unchanged
 * - `undefined` / `null` / unknown  → `undefined` (omit; let Codex use its
 *                                      own default rather than risk a reject)
 */
export function clampCodexEffort(effort: string | undefined | null): CodexEffort | undefined {
  if (!effort) return undefined;
  if (effort === 'xhigh' || effort === 'max') return 'high';
  if ((CODEX_SUPPORTED_EFFORTS as readonly string[]).includes(effort)) {
    return effort as CodexEffort;
  }
  return undefined;
}
