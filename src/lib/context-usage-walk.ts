/**
 * context-usage-walk.ts — pure helper that walks an assistant message
 * list backwards and resolves the `used` baseline + `contextWindow`
 * for `useContextUsage`.
 *
 * Lives outside the React hook so the picking logic is unit-testable
 * without a React renderer. The hook stays a thin wrapper that adds
 * the snapshot fast-path and `useMemo` plumbing.
 *
 * Two non-obvious rules anchored here (both with regression history,
 * see commit messages 2026-05-08):
 *
 *   1. Output-only / all-zero records can't drive the `used` baseline
 *      — the latest tail accounting record sometimes carries
 *      `{input_tokens:0, cache_*:0, output_tokens:N}` and treating
 *      `used = 0` zeros the context bar even though the prior turn's
 *      input + cache is still pinned in the conversation. Walk past
 *      those records when picking baseline.
 *
 *   2. The `context_window` on those skipped records IS still
 *      authoritative — the SDK populates it on every result, not just
 *      on input-bearing turns. Capture the newest positive
 *      `context_window` we see during the walk and use it as a
 *      fallback when the resolved baseline doesn't carry its own.
 *      This is what keeps GLM / Bailian / MiniMax / Kimi / Volcengine
 *      / DeepSeek (models the catalog doesn't enumerate) out of
 *      "capacity unknown."
 */

export interface MinimalMessageForUsage {
  role: 'user' | 'assistant' | string;
  token_usage?: string | object | null;
}

export interface ContextWalkResult {
  /** Assistant turn whose input + cache reflects the current baseline.
   *  Null when no meaningful baseline exists yet. */
  baseline: {
    used: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    /** Window the SDK reported on the BASELINE record itself, if any. */
    sdkContextWindow: number | null;
  } | null;
  /** Newest positive `context_window` seen anywhere in the walk —
   *  including output-only / all-zero records the baseline-finder
   *  skipped. Null when no record carried one. */
  latestSdkContextWindow: number | null;
  /**
   * Phase 1 — newest `context_accounting` snapshot from any assistant
   * message in the walk. Null when no message carries one (older rows /
   * Runtime adapters that haven't implemented produce() yet).
   *
   * Hook feeds via `snapshotToCompilerInputs()` → `buildContextUsageBreakdown({
   * compiler })` so the popover renders real per-Runtime numbers OR
   * hides rows the Runtime declared unsupported.
   *
   * Older rows carrying deprecated `context_breakdown` are intentionally
   * ignored — that shape held Phase 6 Tier 2 假数据 (commit a4fa2d4),
   * Phase 0 (4fcc09e) stopped writing it.
   */
  contextAccounting: import('@/types').RuntimeContextAccountingSnapshot | null;
}

/**
 * Walk messages from the end and produce baseline + the latest SDK
 * context window. Pure — no I/O, no React.
 */
export function walkContextUsage(messages: readonly MinimalMessageForUsage[]): ContextWalkResult {
  let latestSdkContextWindow: number | null = null;
  let latestContextAccounting: ContextWalkResult['contextAccounting'] = null;
  // Fallback baseline — used when no record has non-zero used. Provider
  // proxies (Codex+GLM via codepilot_proxy, Native via OpenRouter) often
  // report `input_tokens=0` even on substantive turns; the old skip rule
  // hid Native+Codex popovers entirely. Use the newest output-only record
  // as a weak baseline so the popover at least shows capacity + breakdown.
  let weakBaseline: ContextWalkResult['baseline'] = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.token_usage) continue;

    let usage: Record<string, unknown>;
    try {
      usage = (typeof msg.token_usage === 'string'
        ? JSON.parse(msg.token_usage)
        : msg.token_usage) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!usage || typeof usage !== 'object') continue;

    const inputTokens = (usage.input_tokens as number) || 0;
    const cacheRead = (usage.cache_read_input_tokens as number) || 0;
    const cacheCreation = (usage.cache_creation_input_tokens as number) || 0;
    const outputTokens = (usage.output_tokens as number) || 0;
    const used = inputTokens + cacheRead + cacheCreation;

    // Capture context_window from THIS record before deciding to skip.
    // Newest wins; once set, later (older) iterations don't overwrite.
    const ctxWindowField = usage.context_window;
    if (
      latestSdkContextWindow === null
      && typeof ctxWindowField === 'number'
      && ctxWindowField > 0
    ) {
      latestSdkContextWindow = ctxWindowField;
    }

    // Phase 1 — pull `context_accounting` snapshot. Capture from EVERY
    // record (newest wins), not just the matched baseline, so Native /
    // Codex turns (often input_tokens=0) still surface their snapshot
    // when the baseline finder falls back to a weak record.
    const accountingField = usage.context_accounting;
    if (
      latestContextAccounting === null
      && accountingField
      && typeof accountingField === 'object'
    ) {
      latestContextAccounting = accountingField as ContextWalkResult['contextAccounting'];
    }

    const baselineSdkContextWindow = typeof ctxWindowField === 'number' && ctxWindowField > 0
      ? ctxWindowField
      : null;

    if (used === 0 && outputTokens === 0) continue; // truly empty — skip

    if (used > 0) {
      // Strong baseline — return immediately.
      return {
        baseline: {
          used,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          outputTokens,
          sdkContextWindow: baselineSdkContextWindow,
        },
        latestSdkContextWindow,
        contextAccounting: latestContextAccounting,
      };
    }

    // used === 0 && outputTokens > 0 → output-only record. Remember as
    // fallback in case no strong baseline exists later (Native+Codex via
    // provider proxies that report input_tokens=0 reliably).
    if (!weakBaseline) {
      weakBaseline = {
        used: 0,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        outputTokens,
        sdkContextWindow: baselineSdkContextWindow,
      };
    }
  }

  // No strong baseline found. If there's a weak (output-only) record,
  // surface it — the popover will show capacity + breakdown even though
  // `used` is 0. Better than rendering an empty popover for Native+Codex.
  return {
    baseline: weakBaseline,
    latestSdkContextWindow,
    contextAccounting: latestContextAccounting,
  };
}
