"use client";

import { useRef, useState } from "react";

import type { ThreadTokenUsage } from "@/codex/protocol/generated/v2/ThreadTokenUsage";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { contextWindowUsageDisplay, formatContextTokens } from "@/lib/context-window-usage";

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextWindowIndicator({
  usage,
}: {
  usage?: ThreadTokenUsage | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const display = contextWindowUsageDisplay(usage);
  const dashOffset = CIRCUMFERENCE * (1 - display.percentUsed / 100);

  const closePinned = () => {
    pinnedRef.current = false;
    setPinned(false);
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && pinnedRef.current) return;
    setOpen(nextOpen);
  };

  const handleClick = () => {
    const nextPinned = !pinnedRef.current;
    pinnedRef.current = nextPinned;
    setPinned(nextPinned);
    setOpen(nextPinned);
  };

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-context-window-indicator=""
          data-percent-used={display.percentUsed}
          data-pinned={pinned ? "" : undefined}
          aria-label={t("contextWindow.ariaLabel" as TranslationKey)}
          aria-expanded={open}
          onClick={handleClick}
          onBlur={closePinned}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <svg viewBox="0 0 20 20" className="size-5 -rotate-90" aria-hidden>
            <circle
              cx="10"
              cy="10"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.22"
              strokeWidth="3"
            />
            <circle
              cx="10"
              cy="10"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-300 ease-out"
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        sideOffset={8}
        onEscapeKeyDown={closePinned}
        onPointerDownOutside={closePinned}
        className="min-w-[220px] rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-md [&>svg]:bg-popover [&>svg]:fill-popover"
      >
        {display.hasData ? (
          <div className="space-y-1 text-center">
            <p className="text-sm text-muted-foreground">
              {t("contextWindow.title" as TranslationKey)}
            </p>
            <p className="text-base text-muted-foreground">
              {t("contextWindow.percentUsed" as TranslationKey, { percent: display.percentUsed })}
            </p>
            <p className="whitespace-nowrap text-base font-medium text-foreground">
              {t("contextWindow.summary" as TranslationKey, {
                used: formatContextTokens(display.usedTokens),
                total: formatContextTokens(display.totalTokens ?? 0),
              })}
            </p>
          </div>
        ) : (
          <div className="space-y-1 text-center">
            <p className="text-sm text-muted-foreground">
              {t("contextWindow.title" as TranslationKey)}
            </p>
            <p className="text-sm font-medium text-foreground">
              {t("contextWindow.unknown" as TranslationKey)}
            </p>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
