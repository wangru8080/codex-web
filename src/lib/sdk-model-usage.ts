/**
 * sdk-model-usage.ts — extract `contextWindow` / `maxOutputTokens`
 * from `SDKResultMessage.modelUsage` (Claude Agent SDK ≥ 0.2.111).
 *
 * Lives in its own module (not inside claude-client.ts) so unit tests
 * can import it directly without pulling claude-client's Node-only
 * dependency tree (fs / os / Sentry / async_hooks / SDK barrel) into
 * the test runner. Pure functions, no side effects.
 */

/** Mirrors `ModelUsage` from `@anthropic-ai/claude-agent-sdk` minus the
 *  fields we don't read here. Decoupled so the test suite doesn't need
 *  the SDK type. */
export interface SdkModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ModelUsageHints {
  /** Alias the caller asked for (e.g. `sonnet`, `glm-5-turbo`). */
  requested?: string;
  /** Resolved upstream id (e.g. `claude-sonnet-4-6`). Some adapters
   *  key `modelUsage` by upstream rather than alias. */
  upstream?: string;
}

/**
 * Pick the entry from `SDKResultMessage.modelUsage` whose contextWindow
 * we should attach to a turn's TokenUsage.
 *
 * Priority:
 *   1. Exact match on requested model id (the alias the caller asked
 *      for).
 *   2. Exact match on resolved upstream model id (catalog mapping).
 *   3. The single entry, when there's exactly one. Common case for
 *      third-party brands the catalog doesn't enumerate (GLM /
 *      Bailian / MiniMax / Kimi / Volcengine / DeepSeek / etc.) — the
 *      SDK round-trips one ModelUsage and walking by name would be
 *      brittle.
 *   4. The first entry with `contextWindow > 0`. Last-resort fallback
 *      so we still surface SDK-reported window when nothing matched.
 *
 * Returns the selected `[key, ModelUsage]` pair or `null` when
 * `modelUsage` is missing/empty (older SDK / adapter doesn't populate
 * it).
 */
export function pickModelUsage(
  modelUsage: Record<string, SdkModelUsage> | undefined,
  hints: ModelUsageHints = {},
): [string, SdkModelUsage] | null {
  if (!modelUsage) return null;
  const entries = Object.entries(modelUsage);
  if (entries.length === 0) return null;

  if (hints.requested && modelUsage[hints.requested]) {
    return [hints.requested, modelUsage[hints.requested]];
  }
  if (hints.upstream && modelUsage[hints.upstream]) {
    return [hints.upstream, modelUsage[hints.upstream]];
  }
  if (entries.length === 1) return entries[0];
  const firstWithWindow = entries.find(([, u]) => u && u.contextWindow > 0);
  return firstWithWindow ?? entries[0];
}
