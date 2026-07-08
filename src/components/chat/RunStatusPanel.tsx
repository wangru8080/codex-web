"use client";

/**
 * Unified Run Status panel — opens from any of the per-chat status
 * cells in the composer (Runtime / Pinned / Permission / Context).
 *
 * Design intent (April 2026 review): the chat composer's bottom-right
 * cluster used to be three separate chips, each linking to a different
 * Settings page. Users had to assemble "this is how the run works" in
 * their head. This panel surfaces all six dimensions in one read-only
 * card, with quiet "→ 设置" links per row when deeper editing is
 * needed. Issues that block the run get a separate flagged section so
 * they can't be missed.
 *
 * The panel is intentionally NOT a settings dialog — it's a status
 * snapshot of THIS chat. All edits redirect to the canonical Settings
 * pages; the panel never writes state itself.
 */

import type { ReactNode } from "react";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { cn } from "@/lib/utils";

interface RowProps {
  label: string;
  value: ReactNode;
  /** Tone affects the value's colour: default / warning / error. */
  tone?: "default" | "warning" | "error";
  /** Optional inline action (rendered as small muted link on the right). */
  actionLabel?: string;
  onAction?: () => void;
}

function Row({ label, value, tone = "default", actionLabel, onAction }: RowProps) {
  const valueClass = cn(
    "min-w-0 flex-1 truncate text-right text-foreground",
    tone === "warning" && "text-status-warning-foreground",
    tone === "error" && "text-status-error-foreground",
  );

  return (
    <div className="group/row flex items-baseline gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={valueClass}>{value}</span>
      {actionLabel && onAction && (
        // Action links default to a very faded weight — the panel's
        // primary job is to *explain* the run, not act as a settings
        // page. Hovering anywhere on the row brings the link up to
        // muted-foreground; hovering the link itself lifts it to full
        // foreground for a clear click affordance.
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/40 transition-colors group-hover/row:text-muted-foreground hover:!text-foreground"
        >
          {actionLabel}
          <CodexWebIcon name="external" size={10} aria-hidden />
        </button>
      )}
    </div>
  );
}

export interface RunStatusIssue {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface RunStatusPanelProps {
  title: string;
  runtime: {
    label: string;
    tone: "default" | "warning";
    onSettings: () => void;
    settingsLabel: string;
  };
  modelRow: {
    value: string;
    tone: "default" | "warning" | "error";
    onSettings: () => void;
    settingsLabel: string;
  };
  defaultModeRow: {
    value: string;
    tone: "default" | "warning";
    onSettings?: () => void;
    settingsLabel?: string;
  };
  permissionRow: {
    value: string;
    tone: "default" | "error";
  };
  contextRow: {
    /** Composed value, e.g. "31K · 16%" or "31K · 容量未知". */
    value: string;
    tone: "default" | "warning" | "error";
  };
  issues?: RunStatusIssue[];
  /** Section labels (i18n). */
  labels: {
    runtime: string;
    model: string;
    defaultMode: string;
    permission: string;
    context: string;
    issuesHeader: string;
  };
}

export function RunStatusPanel({
  title,
  runtime,
  modelRow,
  defaultModeRow,
  permissionRow,
  contextRow,
  issues,
  labels,
}: RunStatusPanelProps) {
  const hasIssues = issues && issues.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">{title}</div>

      <div className="flex flex-col gap-2.5">
        <Row
          label={labels.runtime}
          value={runtime.label}
          tone={runtime.tone}
          actionLabel={runtime.settingsLabel}
          onAction={runtime.onSettings}
        />
        <Row
          label={labels.model}
          value={modelRow.value}
          tone={modelRow.tone}
          actionLabel={modelRow.settingsLabel}
          onAction={modelRow.onSettings}
        />
        <Row
          label={labels.defaultMode}
          value={defaultModeRow.value}
          tone={defaultModeRow.tone}
          actionLabel={defaultModeRow.settingsLabel}
          onAction={defaultModeRow.onSettings}
        />
        <Row
          label={labels.permission}
          value={permissionRow.value}
          tone={permissionRow.tone}
        />
        <Row
          label={labels.context}
          value={contextRow.value}
          tone={contextRow.tone}
        />
      </div>

      {hasIssues && (
        <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
          <div className="text-xs font-medium text-status-warning-foreground">
            {labels.issuesHeader}
          </div>
          <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {issues.map((issue, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-status-warning-foreground" />
                <div className="flex-1 leading-snug">
                  <span>{issue.message}</span>
                  {issue.actionLabel && issue.onAction && (
                    <button
                      type="button"
                      onClick={issue.onAction}
                      className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {issue.actionLabel}
                      <CodexWebIcon name="external" size={10} aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
