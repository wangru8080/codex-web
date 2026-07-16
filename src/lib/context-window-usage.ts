import type { ThreadTokenUsage } from "@/codex/protocol/generated/v2/ThreadTokenUsage";

export interface ContextWindowUsageDisplay {
  hasData: boolean;
  usedTokens: number;
  totalTokens: number | null;
  percentUsed: number;
}

export function contextWindowUsageDisplay(
  usage?: ThreadTokenUsage | null,
): ContextWindowUsageDisplay {
  const usedTokens = Math.max(0, usage?.last.totalTokens ?? 0);
  const totalTokens = usage?.modelContextWindow;
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens) || totalTokens <= 0) {
    return { hasData: false, usedTokens, totalTokens: null, percentUsed: 0 };
  }
  const percentUsed = Math.round(Math.min(1, usedTokens / totalTokens) * 100);
  return { hasData: true, usedTokens, totalTokens, percentUsed };
}

export function formatContextTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  const millions = tokens / 1_000_000;
  return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}m`;
}
