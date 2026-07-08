import { useMemo } from 'react';
import type { Message } from '@/types';
import { getContextWindow } from '@/lib/model-context';
import { walkContextUsage } from '@/lib/context-usage-walk';
import {
  buildContextUsageBreakdown,
  type ContextUsageBreakdown,
} from '@/lib/context-breakdown';
import { snapshotToCompilerInputs } from '@/lib/harness/context-accounting';

export interface ContextUsageData {
  modelName: string;
  contextWindow: number | null;
  /**
   * True only when `contextWindow` came from an SDK/upstream-reported value
   * (not the static catalog fallback). UI must gate percentage / remaining /
   * unused displays on this — an untrusted denominator produced the ">100%"
   * and 假百分比 in #632. When false, show absolute used + kind composition only.
   */
  contextWindowTrusted: boolean;
  /** Actual token usage from the last API response */
  used: number;
  /** Ratio of actual usage to context window */
  ratio: number;
  /** Estimated next-turn token usage (input + output + ~200 for new message overhead) */
  estimatedNextTurn: number;
  /** Ratio of estimated next-turn usage to context window */
  estimatedNextRatio: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  hasData: boolean;
  /** Warning state based on the higher of actual/estimated ratio */
  state: 'normal' | 'warning' | 'critical';
  /** Whether a session summary (compression) is active */
  hasSummary: boolean;
  /**
   * Data source the caller should render next to the number.
   * Phase 5 of agent-sdk-0-2-111:
   *   - 'snapshot': SDK.getContextUsage() capture <60s old (📌)
   *     — extension point, currently has no producer in the codebase;
   *     see claude-client.ts b65c6ac for why.
   *   - 'result_usage': computed from SDKResultMessage.usage's real
   *     input_tokens + cache_read + cache_creation fields (authoritative
   *     API numbers, not char-based estimation). This is the primary
   *     source on the chat page today (📌 accuracy, not ~ estimate).
   *   - 'none': no token data yet
   */
  source: 'snapshot' | 'result_usage' | 'none';
  /** When the snapshot was taken (epoch ms). Undefined for result_usage source. */
  snapshotCapturedAt?: number;
  /**
   * Phase 6 — 10-part token breakdown for the upcoming dot-matrix UI.
   *
   * Phase 1b wires only baseline (used / cacheRead / cacheCreation / output)
   * + contextWindow. Compiler-side fragments (system_prompt / tools / rules /
   * skills / mcp / memory) and composer pending sub-totals will land in
   * Phase 1c + Phase 2 when ChatView / MessageInput pipe them through.
   *
   * Until then, the breakdown surfaces non-zero only for `conversation`
   * and `cache_or_previous`; the other 8 parts read 0 — by design, so
   * consumers can render the dot-matrix shell without waiting for the
   * full data wire. The contract is the same as `buildContextUsageBreakdown`.
   */
  breakdown: ContextUsageBreakdown;
}

const SNAPSHOT_FRESHNESS_MS = 60_000;

export function useContextUsage(
  messages: Message[],
  modelName: string,
  options?: {
    context1m?: boolean;
    hasSummary?: boolean;
    /** Resolved upstream model ID from the catalog (e.g. 'claude-opus-4-7').
     *  Required for aliases whose window depends on provider (first-party
     *  opus = 1M, Bedrock/Vertex opus = 200K). */
    upstreamModelId?: string;
    /**
     * #632 item 1 — whether the session's provider reports a TRUSTWORTHY
     * context window. The SDK-reported `token_usage.context_window` is a real
     * denominator only for a first-party Anthropic endpoint (or a non-Anthropic
     * runtime that reports its own window, e.g. Codex's modelContextWindow). A
     * third-party Anthropic-compatible proxy (GLM / Bailian / Kimi / …) reports
     * the SDK's generic ~200K default. Existing sessions already have that bogus
     * value persisted, so the renderer must gate trust here — the server write
     * gate only protects new turns. `false` → SDK windows are NOT trusted (show
     * used-tokens only). undefined / true → trust (back-compat). Source:
     * ProviderModelGroup.reportedContextWindowTrusted.
     */
    reportedContextWindowTrusted?: boolean;
    /**
     * Phase 5: SDK-authoritative snapshot from Query.getContextUsage().
     * When fresh (<60s), its totalTokens / maxTokens win over the
     * char-based estimator.
     */
    snapshot?: {
      totalTokens: number;
      maxTokens: number;
      capturedAt: number;
    };
    /**
     * Phase 6 Phase 3 — composer-side pending token sub-totals. When
     * provided, flows into `buildContextUsageBreakdown` so the popover's
     * pending kinds (`files_attachments` + `pending_next_turn`) read
     * real per-source numbers instead of 0.
     */
    pending?: {
      attachmentTokens?: number;
      mentionTokens?: number;
      directoryTokens?: number;
      composerTextTokens?: number;
    };
  },
): ContextUsageData {
  return useMemo(() => {
    // Catalog window — the static fallback. Plain `getContextWindow`
    // result; may be `null` for models the catalog doesn't enumerate
    // (GLM / Bailian / Volcengine / MiniMax / Kimi / DeepSeek / etc.).
    // We deliberately don't whitelist those — instead we let the SDK
    // tell us via `token_usage.context_window` (extracted from
    // `SDKResultMessage.modelUsage` in claude-client.ts). This local
    // fallback is what `noData` returns and what we use when the
    // matched message has no SDK-reported window.
    const catalogContextWindow = getContextWindow(modelName, {
      context1m: options?.context1m,
      upstream: options?.upstreamModelId,
    });

    // #632 item 1 — an SDK-reported window (token_usage.context_window) is only
    // a trustworthy denominator when the provider vouches for it. `false` (a
    // third-party Anthropic-compat proxy like GLM) means the persisted window is
    // the SDK's generic ~200K default → don't render a % against it, even for
    // EXISTING sessions whose bogus window is already in the DB. undefined/true
    // → trust (back-compat; the server write gate prevents new bogus windows).
    const reportedWindowTrusted = options?.reportedContextWindowTrusted !== false;

    // Phase 5 — prefer a fresh SDK snapshot over the char:token estimator.
    // Freshness window matches the plan (60s). Beyond that, the estimator
    // takes over and the `source` flag flips so the UI can signal the
    // change to the user.
    const snap = options?.snapshot;
    // Date.now() is technically impure inside useMemo, but the freshness
    // check is a one-shot snapshot-vs-now comparison that naturally
    // re-evaluates on the next render when `messages` / `modelName` /
    // snapshot identity changes — which is exactly when staleness matters.
    // eslint-disable-next-line react-hooks/purity
    const snapFresh = snap && (Date.now() - snap.capturedAt) < SNAPSHOT_FRESHNESS_MS;
    if (snap && snapFresh) {
      const used = snap.totalTokens;
      const max = snap.maxTokens || catalogContextWindow || used;
      const ratio = max ? used / max : 0;
      // Trusted only when the SDK snapshot itself reported a real maxTokens
      // (#632) — a fallback to catalog/used is not a trustworthy denominator.
      const snapWindowTrusted = (snap.maxTokens ?? 0) > 0 && reportedWindowTrusted;
      // No estimated-next-turn from the snapshot — we assume next turn is
      // similar to current (snapshot is authoritative on "used now" but
      // can't project future output).
      return {
        modelName,
        contextWindow: max,
        contextWindowTrusted: snapWindowTrusted,
        used,
        ratio,
        estimatedNextTurn: used,
        estimatedNextRatio: ratio,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        hasData: true,
        state: ratio >= 0.95 ? 'critical' : ratio >= 0.8 ? 'warning' : 'normal',
        hasSummary: options?.hasSummary || false,
        source: 'snapshot',
        snapshotCapturedAt: snap.capturedAt,
        breakdown: buildContextUsageBreakdown({
          baseline: {
            used,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 0,
          },
          contextWindow: snapWindowTrusted ? max : undefined,
          pending: options?.pending,
        }),
      };
    }

    // Walk assistant token_usage records from the end. The pure
    // logic — including the output-only skip + the
    // latestSdkContextWindow capture — lives in
    // `lib/context-usage-walk.ts` so it can be tested without React.
    // See that module's doc-block for the two non-obvious rules
    // (output-only baseline skip + context_window preservation).
    const { baseline, latestSdkContextWindow, contextAccounting } = walkContextUsage(messages);

    if (baseline) {
      // Resolve contextWindow priority:
      //   1. This baseline record's own SDK-reported window.
      //   2. The newest SDK window seen anywhere in the walk —
      //      typically a more-recent output-only tail.
      //   3. The static `getContextWindow()` catalog fallback.
      // Older DB rows without `context_window` correctly fall
      // through to (2) and (3).
      const sdkContextWindow = baseline.sdkContextWindow;
      const contextWindow = sdkContextWindow
        ?? latestSdkContextWindow
        ?? catalogContextWindow;

      // v0.56.x Phase 2 (#632) — the window is only a TRUSTED denominator
      // when the SDK / upstream actually reported it. The static
      // `catalogContextWindow` fallback is a guess; rendering a percentage /
      // remaining / unused against it is what produced the ">100%" and
      // 假百分比 the user reported (a stale or wrong guess + post-compaction
      // used jumps). When untrusted we surface absolute used + kind
      // composition only (no %, no remaining, no unused, no fabricated total).
      const contextWindowTrusted = (sdkContextWindow != null || latestSdkContextWindow != null) && reportedWindowTrusted;

      const outputTokens = baseline.outputTokens;
      // Build breakdown first — its usedTokens may promote past baseline.used
      // when provider proxies (Native/Codex+GLM) report input_tokens=0 but
      // entries surface real per-turn tokens. Header used/ratio must match
      // breakdown sum or popover looks inconsistent ("0" header vs 3.5K rows).
      const breakdown = buildContextUsageBreakdown({
        baseline: {
          used: baseline.used,
          cacheReadTokens: baseline.cacheReadTokens,
          cacheCreationTokens: baseline.cacheCreationTokens,
          outputTokens,
        },
        // Untrusted window → omit it so the breakdown / dot-matrix fall back
        // to a used-relative composition view instead of a fabricated capacity.
        contextWindow: contextWindowTrusted ? (contextWindow ?? undefined) : undefined,
        pending: options?.pending,
        // Phase 1 (Context Accounting Runtime Contract, 2026-05-20):
        // feed compiler inputs from the Runtime-produced snapshot.
        // snapshotToCompilerInputs returns undefined when the snapshot
        // is missing OR every kind is unsupported / empty → all
        // compiler-side rows hide (conversation absorbs residual).
        // Old `context_breakdown` rows are intentionally NOT honored
        // — that field held 假数据 (Phase 0 deleted the writer).
        compiler: snapshotToCompilerInputs(contextAccounting),
      });
      const used = breakdown.usedTokens;
      const ratio = contextWindow ? used / contextWindow : 0;

      // Estimate next turn: current input context + this turn's output + ~200 token overhead for a new user message
      const estimatedNextTurn = used + outputTokens + 200;
      const estimatedNextRatio = contextWindow ? estimatedNextTurn / contextWindow : 0;

      // Warning state uses the higher of actual and estimated ratios
      const effectiveRatio = Math.max(ratio, estimatedNextRatio);
      let state: 'normal' | 'warning' | 'critical' = 'normal';
      if (effectiveRatio >= 0.95) state = 'critical';
      else if (effectiveRatio >= 0.8) state = 'warning';

      return {
        modelName,
        contextWindow,
        contextWindowTrusted,
        used,
        ratio,
        estimatedNextTurn,
        estimatedNextRatio,
        cacheReadTokens: baseline.cacheReadTokens,
        cacheCreationTokens: baseline.cacheCreationTokens,
        outputTokens,
        hasData: true,
        state,
        hasSummary: options?.hasSummary || false,
        source: 'result_usage',
        breakdown,
      };
    }

    // No meaningful baseline found. Still surface the SDK-reported
    // capacity if we saw one during the walk — a brand-new session
    // whose first assistant turn was output-only shouldn't lose the
    // capacity badge. `hasData` stays false because we have no real
    // `used` to draw a percent from; RunCockpit's fallback path
    // renders the breakdown without the ratio bar in that case.
    return {
      modelName,
      contextWindow: latestSdkContextWindow ?? catalogContextWindow,
      // Trusted only if an SDK window was actually seen during the walk AND the
      // provider vouches for it (#632) — catalog fallback alone, or a third-party
      // proxy's SDK default, is not a trustworthy denominator.
      contextWindowTrusted: latestSdkContextWindow != null && reportedWindowTrusted,
      used: 0,
      ratio: 0,
      estimatedNextTurn: 0,
      estimatedNextRatio: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      hasData: false,
      state: 'normal',
      hasSummary: options?.hasSummary || false,
      source: 'none' as const,
      breakdown: buildContextUsageBreakdown({
        contextWindow: latestSdkContextWindow != null && reportedWindowTrusted
          ? (latestSdkContextWindow ?? catalogContextWindow) ?? undefined
          : undefined,
        pending: options?.pending,
      }),
    };
  }, [messages, modelName, options?.context1m, options?.hasSummary, options?.upstreamModelId, options?.snapshot, options?.pending, options?.reportedContextWindowTrusted]);
}
