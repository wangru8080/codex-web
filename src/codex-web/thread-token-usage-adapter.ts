import type { ThreadTokenUsage } from "@/codex/protocol/generated/v2/ThreadTokenUsage";

import type { Sourced } from "./app-server-state";

export type ThreadTokenUsageByThreadId = Record<string, Sourced<ThreadTokenUsage>>;

export function reduceThreadTokenUsageNotification(
  current: ThreadTokenUsageByThreadId,
  notification: { method: string; params?: unknown },
): ThreadTokenUsageByThreadId {
  if (notification.method !== "thread/tokenUsage/updated") return current;
  const params = readRecord(notification.params);
  if (
    typeof params.threadId !== "string"
    || typeof params.turnId !== "string"
    || !isThreadTokenUsage(params.tokenUsage)
  ) {
    return current;
  }

  return {
    ...current,
    [params.threadId]: {
      source: "app-server.thread/tokenUsage/updated",
      data: params.tokenUsage,
    },
  };
}

function isThreadTokenUsage(value: unknown): value is ThreadTokenUsage {
  const usage = readRecord(value);
  return isTokenUsageBreakdown(usage.total)
    && isTokenUsageBreakdown(usage.last)
    && (
      usage.modelContextWindow === null
      || (
        typeof usage.modelContextWindow === "number"
        && Number.isFinite(usage.modelContextWindow)
        && usage.modelContextWindow > 0
      )
    );
}

function isTokenUsageBreakdown(value: unknown): boolean {
  const usage = readRecord(value);
  return [
    usage.totalTokens,
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.reasoningOutputTokens,
  ].every((tokenCount) => (
    typeof tokenCount === "number" && Number.isFinite(tokenCount) && tokenCount >= 0
  ));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
