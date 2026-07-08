import { type ReactNode, type RefObject, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* ------------------------------------------------------------------ */
/*  CommandList — shared popover/command-list pattern                  */
/*  Pure presentation; no data fetching or business logic.            */
/* ------------------------------------------------------------------ */

// ── Root container ──────────────────────────────────────────────────

interface CommandListProps {
  children: ReactNode;
  className?: string;
}

export function CommandList({ children, className }: CommandListProps) {
  return (
    <div
      className={cn(
        // Geometry + shadow tuned to match the chat composer input box:
        // same 24px radius (rounded-2xl) + same `--shadow-diffuse` token,
        // so the popover reads as part of the same surface as the input.
        "absolute bottom-full left-0 mb-2 rounded-2xl border bg-popover overflow-hidden z-50",
        "shadow-[var(--shadow-diffuse)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Search input ────────────────────────────────────────────────────

interface CommandListSearchProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function CommandListSearch({
  value,
  onChange,
  onKeyDown,
  placeholder = "Search...",
  inputRef,
}: CommandListSearchProps) {
  return (
    <div className="px-3 py-2 border-b">
      <Input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-auto w-full border-0 bg-transparent p-0 text-sm text-foreground shadow-none placeholder:text-muted-foreground outline-none focus-visible:ring-0 focus-visible:border-transparent"
      />
    </div>
  );
}

// ── Scrollable items area ───────────────────────────────────────────

interface CommandListItemsProps {
  children: ReactNode;
  className?: string;
}

export function CommandListItems({ children, className }: CommandListItemsProps) {
  return (
    <div className={cn("max-h-64 overflow-y-auto overflow-x-hidden p-1", className)}>
      {children}
    </div>
  );
}

// ── Single item ─────────────────────────────────────────────────────

interface CommandListItemProps {
  active?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  children: ReactNode;
  className?: string;
  itemRef?: (el: HTMLButtonElement | null) => void;
  /**
   * Phase 6 UI收口 P2 (2026-05-14) — render the item in a non-clickable
   * disabled state. Picker uses this to surface models that aren't
   * compatible with the current runtime alongside the compatible ones
   * (instead of hiding them server-side and confusing users about
   * where their providers went). Pair with `tooltip` so hover reveals
   * the per-runtime reason from `unsupportedReasonByRuntime`.
   */
  disabled?: boolean;
  /** Native hover tooltip (uses HTML title attribute). Renders both on
   *  enabled and disabled items, but is most useful on disabled rows. */
  tooltip?: string;
}

export function CommandListItem({
  active,
  onClick,
  onMouseEnter,
  children,
  className,
  itemRef,
  disabled,
  tooltip,
}: CommandListItemProps) {
  return (
    <Button
      type="button"
      ref={itemRef}
      variant="ghost"
      size="sm"
      disabled={disabled}
      title={tooltip}
      className={cn(
        // Inset rounded item (mx-1) so the highlight doesn't touch the
        // popover's edge — feels like the muted toolbar buttons rather
        // than a flat list row. Active = the same accent we use for
        // hover, so selection reads as "intensified hover" instead of a
        // separate strong state.
        "flex w-full items-center justify-start gap-2 rounded-md px-2.5 py-2 text-left text-sm font-normal transition-colors h-auto",
        active ? "bg-accent text-foreground" : "hover:bg-accent hover:text-foreground",
        // Disabled rows are dimmed + non-interactive but still hoverable
        // so the title tooltip surfaces — the cursor change + reduced
        // opacity tells users the row is the reason "you can't pick me"
        // and the tooltip explains why.
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground",
        className,
      )}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={disabled ? undefined : onMouseEnter}
    >
      {children}
    </Button>
  );
}

// ── Group with label header ─────────────────────────────────────────
// Grouping is communicated by typography contrast (bold dark label vs
// regular muted items) and vertical whitespace between groups — no
// horizontal divider lines (per April 2026 feedback: "靠字体间距以及
// 是否加粗去区分视觉重点和分组").

interface CommandListGroupProps {
  /** Group header. Pass a string for the common case or a ReactNode
   *  when you need inline elements (e.g. a compat badge next to the
   *  group name in the chat picker dropdown). */
  label?: ReactNode;
  children: ReactNode;
}

export function CommandListGroup({ label, children }: CommandListGroupProps) {
  return (
    <div className="first:mt-0 mt-3">
      {label && (
        <div className="px-2.5 pb-1 pt-1 text-xs font-semibold text-foreground">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────

interface CommandListFooterProps {
  children: ReactNode;
}

export function CommandListFooter({ children }: CommandListFooterProps) {
  return (
    <div className="border-t px-3 py-1.5">
      {children}
    </div>
  );
}

// ── Footer action button ────────────────────────────────────────────

interface CommandListFooterActionProps {
  onClick?: () => void;
  children: ReactNode;
}

export function CommandListFooterAction({ onClick, children }: CommandListFooterActionProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="flex w-full items-center justify-start gap-2 rounded-none px-0 py-1 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-transparent h-auto transition-colors"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

interface CommandListEmptyProps {
  children: ReactNode;
}

export function CommandListEmpty({ children }: CommandListEmptyProps) {
  return (
    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}
