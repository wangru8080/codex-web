"use client";

/**
 * One status card for the Overview dashboard grid.
 *
 * Visual rule:
 *   - `tone="warning"` cards pick up `status-warning-muted` accent + a
 *     dark filled CTA (this card needs the user to act).
 *   - `tone="success" / "muted"` cards stay flat with a ghost CTA.
 *
 * That's the rule that keeps Overview reading as a status dashboard
 * rather than a wall of uniform black tiles — configured cards fade,
 * attention-needed cards pop.
 */

import { Button } from "@/components/ui/button";
import { CaretRight } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface OverviewCardProps {
  icon: React.ReactNode;
  title: string;
  tone: "success" | "warning" | "muted";
  children: React.ReactNode;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  footer?: React.ReactNode;
}

export function OverviewCard({
  icon,
  title,
  tone,
  children,
  primaryActionLabel,
  onPrimaryAction,
  footer,
}: OverviewCardProps) {
  const dotTone: Record<OverviewCardProps["tone"], string> = {
    success: "bg-status-success-foreground",
    warning: "bg-status-warning-foreground",
    muted: "bg-muted-foreground/40",
  };
  const needsAttention = tone === "warning";
  return (
    <div
      className={cn(
        "rounded-lg border p-5 flex flex-col gap-3 h-full",
        needsAttention
          ? "border-status-warning-border bg-status-warning-muted/30"
          : "border-border/50 bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-foreground/65">{icon}</span>
        <h3 className="text-sm font-semibold leading-tight flex-1 min-w-0">
          {title}
        </h3>
        <span className={cn("size-1.5 rounded-full shrink-0", dotTone[tone])} />
      </div>
      <div className="text-xs text-foreground/85 space-y-1.5 flex-1">
        {children}
      </div>
      <div className="pt-1 flex items-center gap-2 flex-wrap">
        <Button
          variant={needsAttention ? "default" : "ghost"}
          size="sm"
          className={cn(
            "gap-1 text-xs",
            needsAttention
              ? "h-7 px-3"
              : "-ml-2 text-muted-foreground hover:text-foreground",
          )}
          onClick={onPrimaryAction}
        >
          {primaryActionLabel}
          {!needsAttention && <CaretRight size={12} weight="bold" />}
        </Button>
        {footer}
      </div>
    </div>
  );
}
