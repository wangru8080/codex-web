"use client";

/**
 * Per-chat run status — bottom-right of the chat composer.
 *
 * Architecture (2026-05-09 follow-up): the SHELL (this file) is the
 * always-rendered trigger button. It owns only the lightweight bits
 * needed to draw the Context ring + token text:
 *   • props from ChatView / chat/page (providerId, modelName,
 *     runtimePin, permissionProfile, messages, …)
 *   • `useContextUsage` hook output (already required for the trigger
 *     ring percentage)
 *   • `<Context>` provider wrapper from ai-elements/context (so the
 *     popover's ContextContent.* consumers see the same numbers)
 *
 * The HEAVY half — `useOverviewData` (Settings overview data layer
 * that transitively pulls runtime/effective + provider catalog into
 * the dev compile graph), `useClaudeStatus`, severity classification,
 * provider/model lookup, ai-elements/context's ContextContent.*
 * family, the issues block — lives in
 * `RunCockpitPopoverContent.tsx`. That file is loaded via
 * `next/dynamic({ ssr: false })`, and Radix's `<PopoverContent>` only
 * mounts its children when the popover opens, so the chunk only
 * resolves the first time the user actually clicks the trigger.
 *
 * What the trigger LOST in the split (deliberate, not a regression):
 *   - The severity-driven Warning glyph and color tint on the trigger.
 *     RunCheckpoint above the composer is the canonical surface for
 *     blocking issues; duplicating the alert here meant the trigger
 *     had to read overview state synchronously to color itself.
 *   - The "· 固定" pinned-mode chip text on the trigger. Same reason —
 *     it depended on `state.defaultMode === 'pinned'`. The pinned
 *     status row stays visible inside the popover.
 *
 * Locked in by `src/__tests__/unit/chat-static-graph.test.ts`.
 */

import dynamic from "next/dynamic";
import type { LanguageModelUsage } from "ai";
import type { Message, PermissionProfile } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { useContextUsage } from "@/hooks/useContextUsage";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
// Lightweight provider — publishes usedTokens / maxTokens / usage /
// modelId into React context without dragging in the full
// `ai-elements/context.tsx` kit (which pulls tokenlens / HoverCard /
// Progress / Button into the chat first-paint compile graph). The
// lazy popover content imports the heavy ContextContent.* family
// from `./context` and reads from the SAME context identity exported
// via context-core.
import { ContextProvider } from "@/components/ai-elements/context-core";
// Phase 6 Phase 2c — dot-matrix mini-bar for the trigger. Pure component
// + only depends on @/lib/context-breakdown (pure data layer, no deep
// graph). Safe for chat first-paint.
import { ContextDotMatrix } from "@/components/chat/context-breakdown/ContextDotMatrix";

// Heavy popover body — resolved on first popover open, never on /chat
// boot. The dynamic loader is what keeps `useOverviewData` + provider
// catalog + runtime/effective off the chat first-paint compile graph.
const RunCockpitPopoverContent = dynamic(
  () =>
    import("./RunCockpitPopoverContent").then((m) => ({
      default: m.RunCockpitPopoverContent,
    })),
  { ssr: false },
);

function formatTokensCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "")) + "K";
  }
  return String(n);
}

// Phase 6 Phase 2c (2026-05-19): the trigger's environment-ring SVG is
// replaced by a 10-cell mini dot-matrix that uses the same
// ContextDotMatrix component and CSS palette as the popover main bar.
// 10 cells = 10% per cell; preserves the "filled / empty" capacity feel
// without dropping the by-source color stripe Phase 6 is selling.

interface RunCockpitProps {
  /** Active chat's provider — drives session-level runtime overrides
   *  (OpenAI OAuth → forced Native). Forwarded to the popover for the
   *  model-row label lookup. */
  providerId?: string;
  /** Chat messages, for context-usage calculation. Pass `[]` on the
   *  first-message page (before any assistant turn). */
  messages?: Message[];
  /** Currently selected model name. */
  modelName?: string;
  /** Whether `context-1m-2025-08-07` is enabled for this chat. */
  context1m?: boolean;
  /** Whether a session summary (compaction) is active. */
  hasSummary?: boolean;
  /** Resolved upstream model ID for accurate context-window lookup. */
  upstreamModelId?: string;
  /** SDK-authoritative usage snapshot (Phase 5). */
  contextUsageSnapshot?: {
    totalTokens: number;
    maxTokens: number;
    capturedAt: number;
  };
  /** Active chat's permission profile. */
  permissionProfile?: PermissionProfile;
  /** Pre-send token estimate for currently attached @ mention chips.
   *  Surfaced as a "+10K 待加" suffix in the trigger label so the user
   *  can preview the cost. Resets to 0 after send. */
  pendingContextTokens?: number;
  /** Phase 6 Phase 3 — per-source split of pendingContextTokens. When
   *  provided, flows into useContextUsage → breakdown so the popover's
   *  `files_attachments` row shows real numbers instead of 0. Resets
   *  on send alongside pendingContextTokens. */
  pendingContextSubTotals?: {
    attachment: number;
    mention: number;
    directory: number;
  };
  /** Step 4c round 4 — session-level runtime pin from the composer's
   *  RuntimeSelector. Forwarded to the popover so it can suppress
   *  global pinned/runtime-fallback signals when the user has
   *  explicitly opted out of the global default for this session. */
  sessionRuntimePin?: string;
  /**
   * #632 item 1 — whether this session's provider reports a trustworthy
   * context window (false only for a third-party Anthropic-compatible proxy
   * like GLM). Forwarded to useContextUsage so an existing third-party session
   * stops rendering a fake "200K" capacity. Resolved by the parent from the
   * provider group's `reportedContextWindowTrusted`.
   */
  reportedContextWindowTrusted?: boolean;
}

export function RunCockpit({
  providerId,
  messages = [],
  modelName = "",
  context1m,
  hasSummary,
  upstreamModelId,
  contextUsageSnapshot,
  permissionProfile = "request_approval",
  pendingContextTokens = 0,
  pendingContextSubTotals,
  sessionRuntimePin,
  reportedContextWindowTrusted,
}: RunCockpitProps = {}) {
  const { t } = useTranslation();
  const usage = useContextUsage(messages, modelName, {
    context1m,
    hasSummary,
    upstreamModelId,
    reportedContextWindowTrusted,
    snapshot: contextUsageSnapshot,
    pending: pendingContextSubTotals
      ? {
          attachmentTokens: pendingContextSubTotals.attachment,
          mentionTokens: pendingContextSubTotals.mention,
          directoryTokens: pendingContextSubTotals.directory,
        }
      : undefined,
  });

  // Pending-tokens suffix surfaces the @ mention chip cost preview.
  const pendingSuffix =
    pendingContextTokens > 0
      ? ` +${formatTokensCompact(pendingContextTokens)}`
      : "";

  // v0.56.x Phase 2 (#632) — only show a percentage when the context window
  // is a TRUSTED (SDK/upstream-reported) denominator. Catalog fallback →
  // hasFullCtx=false → fall through to the absolute used-tokens display.
  const hasFullCtx = usage.hasData && usage.contextWindowTrusted && (usage.contextWindow ?? 0) > 0;
  const ringPercent = hasFullCtx ? Math.min(1, Math.max(0, usage.ratio)) : 0;
  // Clamp the displayed percentage to ≤100% — a trusted window can still be
  // momentarily exceeded by `used` (e.g. right after compaction); never show >100%.
  const clampedRatio = Math.min(1, Math.max(0, usage.ratio));
  // Trusted window → show "percent + used" together (e.g. "56.6% 452K") per
  // user spec; untrusted → used absolute only. No standalone "remaining" number.
  const ratioText = hasFullCtx
    ? `${(clampedRatio * 100).toFixed(1)}% ${formatTokensCompact(usage.used)}${pendingSuffix}`
    : usage.hasData
      ? `${formatTokensCompact(usage.used)}${pendingSuffix}`
      : pendingContextTokens > 0
        ? `+${formatTokensCompact(pendingContextTokens)}`
        : "—";

  // Trigger button — neutral muted-foreground color, no severity tint
  // (severity classification depends on overview data; that lives in
  // the lazy popover content). RunCheckpoint above the composer is the
  // canonical surface for blocking issues, so the trigger doesn't need
  // to duplicate the alert chrome here.
  // Suppress unused-warning: ringPercent is no longer consumed (Phase 2c
  // replaced the ring SVG with the dot-matrix mini-bar), but the legacy
  // computation is kept for any future fallback.
  void ringPercent;

  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={t("runStatus.triggerLabel" as TranslationKey)}
      className="h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors"
    >
      {/* v0.56.x #632 follow-up — the mini capacity bar only makes sense
          against a TRUSTED window. When untrusted (catalog fallback / none)
          we'd be drawing a "used / remaining" gauge against a guess, so hide
          it and let the trigger show only the absolute used-token text. */}
      {hasFullCtx && (
        <ContextDotMatrix
          breakdown={usage.breakdown}
          cellCount={10}
          rows={1}
          minCellsPerKind={0}
          className="w-[44px] shrink-0"
        />
      )}
      <span className="truncate">{ratioText}</span>
    </Button>
  );

  const lmUsage: LanguageModelUsage | undefined = usage.hasData
    ? {
        inputTokens: Math.max(
          0,
          usage.used - usage.cacheReadTokens - usage.cacheCreationTokens,
        ),
        inputTokenDetails: {
          noCacheTokens: Math.max(
            0,
            usage.used - usage.cacheReadTokens - usage.cacheCreationTokens,
          ),
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheCreationTokens,
        },
        outputTokens: usage.outputTokens,
        outputTokenDetails: {
          textTokens: usage.outputTokens,
          reasoningTokens: undefined,
        },
        totalTokens: usage.used + usage.outputTokens,
        cachedInputTokens: usage.cacheReadTokens,
      }
    : undefined;

  const popoverInner = (
    <RunCockpitPopoverContent
      providerId={providerId}
      modelName={modelName}
      upstreamModelId={upstreamModelId}
      permissionProfile={permissionProfile}
      sessionRuntimePin={sessionRuntimePin}
      pendingSuffix={pendingSuffix}
      hasFullCtx={hasFullCtx}
      usage={usage}
    />
  );

  // Full-context path — wrap the Popover in `<ContextProvider>` so the
  // ContextContent.* consumers inside the lazy popover content read
  // the same usedTokens / maxTokens / usage / modelId values via React
  // context. The provider is the lightweight half of `ai-elements/context`;
  // the original `<Context>` ALSO wrapped in HoverCard, but we never
  // used the hover-card affordance (the inner Popover owns open/close)
  // and HoverCard's chunk pulls Progress / Button / tokenlens into the
  // chat first-paint graph. ContextProvider drops all of that.
  if (hasFullCtx) {
    return (
      <ContextProvider
        usedTokens={usage.used}
        maxTokens={usage.contextWindow!}
        usage={lmUsage}
        modelId={upstreamModelId ?? modelName}
      >
        <Popover>
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-80 overflow-hidden p-3"
          >
            {popoverInner}
          </PopoverContent>
        </Popover>
      </ContextProvider>
    );
  }

  // Fallback path — either no usage data yet (pre-first-response) or
  // we have usage but `contextWindow` couldn't be resolved for this
  // model. The popover content handles both branches internally
  // (showUnknownCapacityBlock).
  //
  // 2026-05-20 bug fix: previously this used `divide-y overflow-hidden p-0`
  // (legacy class from pre-redesign popover). The inner popover content
  // assumes `p-3` outer wrapper — it draws its own divider via
  // `<div className="-mx-3 my-2 border-t" />` which depends on outer
  // padding for the negative-margin trick to stretch the line across.
  // With `p-0` outer, the inner content rendered without padding and
  // the divider's `-mx-3` reached outside the popover, causing the
  // popover to land on top of conversation text (user report: "Native
  // 弹窗的浮层把文字一部分遮住了，其他渠道没问题"). Unified with the
  // hasFullCtx branch's `p-3 overflow-hidden`.
  return (
    <Popover>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 overflow-hidden p-3"
      >
        {popoverInner}
      </PopoverContent>
    </Popover>
  );
}
