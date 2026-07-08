"use client";

/**
 * Codex Account quota widget — Phase 5 Phase 6 IA correction (2026-05-14).
 *
 * Renders the rate-limit snapshot from /api/codex/rate-limits inside the
 * Providers' virtual Codex Account card. Codex's `account/rateLimits/read`
 * gives `usedPercent + resetsAt` per window (no absolute remaining tokens),
 * so the widget text must read "已用 X%" / "rolls over in Y", never
 * "remaining N tokens" — the latter doesn't exist upstream.
 *
 * Layout:
 *   ┌─────────────────────────────────┐
 *   │  使用配额                       │
 *   │  5 小时窗口        已用 1%     │
 *   │  ▓░░░░░░░░░░░░░░  4 小时后重置  │
 *   │  7 天窗口          已用 7%     │
 *   │  ▓░░░░░░░░░░░░░░  6 天后重置    │
 *   │  余额: $0.42  (only if credits present) │
 *   └─────────────────────────────────┘
 */

import type { CodexRateLimitSnapshot, CodexRateLimitWindow } from "@/lib/codex/types";
import { cn } from "@/lib/utils";
import { Warning } from "@/components/ui/icon";

function formatWindowLabel(mins: number | undefined, isZh: boolean): string {
  if (!mins || mins <= 0) return isZh ? "窗口" : "Window";
  if (mins < 120) return isZh ? `${mins} 分钟窗口` : `${mins}min window`;
  if (mins < 60 * 24) {
    const hrs = Math.round(mins / 60);
    return isZh ? `${hrs} 小时窗口` : `${hrs}h window`;
  }
  const days = Math.round(mins / 60 / 24);
  return isZh ? `${days} 天窗口` : `${days}d window`;
}

function formatResetsAt(epochSec: number | undefined, isZh: boolean): string {
  if (!epochSec) return "";
  const nowMs = Date.now();
  const diffMs = epochSec * 1000 - nowMs;
  if (diffMs <= 0) return isZh ? "已重置" : "Rolled over";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return isZh ? `${mins} 分钟后重置` : `Resets in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return isZh ? `${hrs} 小时后重置` : `Resets in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return isZh ? `${days} 天后重置` : `Resets in ${days}d`;
}

function tone(usedPercent: number): { bar: string; pct: string } {
  // 0-60: success, 60-85: warning, 85+: error
  if (usedPercent >= 85) {
    return {
      bar: "bg-status-error-foreground",
      pct: "text-status-error-foreground",
    };
  }
  if (usedPercent >= 60) {
    return {
      bar: "bg-status-warning-foreground",
      pct: "text-status-warning-foreground",
    };
  }
  return {
    bar: "bg-status-success-foreground",
    pct: "text-status-success-foreground",
  };
}

function WindowRow({ label, window, isZh }: { label: string; window: CodexRateLimitWindow; isZh: boolean }) {
  const pct = Math.max(0, Math.min(100, window.usedPercent));
  const t = tone(pct);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-mono font-medium", t.pct)}>
          {isZh ? `已用 ${pct.toFixed(0)}%` : `${pct.toFixed(0)}% used`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", t.bar)} style={{ width: `${pct}%` }} />
      </div>
      {window.resetsAt && (
        <div className="text-[10px] text-muted-foreground">
          {formatResetsAt(window.resetsAt, isZh)}
        </div>
      )}
    </div>
  );
}

interface CodexQuotaWidgetProps {
  snapshot: CodexRateLimitSnapshot;
  isZh: boolean;
}

export function CodexQuotaWidget({ snapshot, isZh }: CodexQuotaWidgetProps) {
  const hasPrimary = !!snapshot.primary;
  const hasSecondary = !!snapshot.secondary;
  const hasCredits = !!snapshot.credits;
  const isRateLimited = !!snapshot.rateLimitReachedType;
  if (!hasPrimary && !hasSecondary && !hasCredits && !isRateLimited) return null;
  return (
    <div className="rounded-md bg-muted/30 px-3.5 py-3 flex flex-col gap-3 mt-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        {isZh ? "使用配额" : "Usage quota"}
      </div>
      {snapshot.primary && (
        <WindowRow
          label={formatWindowLabel(snapshot.primary.windowDurationMins, isZh)}
          window={snapshot.primary}
          isZh={isZh}
        />
      )}
      {snapshot.secondary && (
        <WindowRow
          label={formatWindowLabel(snapshot.secondary.windowDurationMins, isZh)}
          window={snapshot.secondary}
          isZh={isZh}
        />
      )}
      {snapshot.credits && (snapshot.credits.unlimited || (snapshot.credits.hasCredits && snapshot.credits.balance)) && (
        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/40">
          <span className="text-muted-foreground">{isZh ? "余额" : "Balance"}</span>
          <span className="font-mono">
            {snapshot.credits.unlimited
              ? (isZh ? "不限" : "Unlimited")
              : snapshot.credits.balance ?? "—"}
          </span>
        </div>
      )}
      {isRateLimited && (
        <div className="flex items-start gap-1.5 text-[11px] text-status-warning-foreground">
          <Warning size={12} weight="fill" className="shrink-0 mt-0.5" />
          <span>
            {isZh ? "已触达配额上限：" : "Rate limit reached: "}
            <span className="font-mono">{snapshot.rateLimitReachedType}</span>
          </span>
        </div>
      )}
    </div>
  );
}
