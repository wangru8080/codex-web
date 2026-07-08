"use client";

/**
 * Built-in MCP capabilities — read-only descriptor of every in-process
 * MCP CodexWeb ships (Phase 2D.2 + 2026-05-01 visual unification).
 *
 * Visual rule: the card chrome mirrors the canonical Settings shell card
 * (`ProviderCard.tsx`, `OverviewSection.tsx`) — `rounded-lg bg-card
 * border border-border/50 p-5`, no shadow, soft border. shadcn's
 * `<Card>` component is intentionally avoided because its defaults
 * (`rounded-3xl shadow-md ring-1 px-6`) conflict with `docs/design.md`.
 *
 * Detail (full tools list + trigger explanation) lives behind a click
 * → `<Dialog>`. This section is purely descriptive — it doesn't try to
 * report whether a MCP is registered for the current message; the
 * section header explicitly disclaims live status.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import {
  BUILTIN_MCP_CATALOG,
  type BuiltInMcpEntry,
  type BuiltInMcpTriggerCondition,
} from "@/lib/builtin-mcp-catalog";

const TRIGGER_LABEL_KEY: Record<BuiltInMcpTriggerCondition, TranslationKey> = {
  always: "mcp.builtin.trigger.always",
  workspace: "mcp.builtin.trigger.workspace",
  keyword: "mcp.builtin.trigger.keyword",
};

// Status-pill dialect from `docs/design.md` § Status & source badges —
// rounded-full, dot + label, muted background tones.
const TRIGGER_TONE: Record<BuiltInMcpTriggerCondition, string> = {
  always: "bg-status-success-muted text-status-success-foreground",
  workspace: "bg-primary/10 text-primary",
  keyword: "bg-muted text-muted-foreground",
};

const TRIGGER_DOT_TONE: Record<BuiltInMcpTriggerCondition, string> = {
  always: "bg-status-success-foreground",
  workspace: "bg-primary",
  keyword: "bg-muted-foreground",
};

export function BuiltInMcpSection({ search = "" }: { search?: string }) {
  const { t } = useTranslation();
  const [openEntry, setOpenEntry] = useState<BuiltInMcpEntry | null>(null);

  // Free-text filter against name + (translated) description so the
  // global ExtensionsPage search box can scope to MCP rows.
  const query = search.trim().toLowerCase();
  const visible = query
    ? BUILTIN_MCP_CATALOG.filter((entry) => {
        const description = t(entry.descriptionKey as TranslationKey).toLowerCase();
        return entry.name.toLowerCase().includes(query) || description.includes(query);
      })
    : BUILTIN_MCP_CATALOG;

  // When the filter hides every built-in row, swallow the whole
  // section — no header, no dialog mount — so the search result
  // doesn't show an empty 内置能力 stub above the installed list.
  if (visible.length === 0) {
    return (
      <BuiltInMcpDetailDialog
        entry={openEntry}
        onClose={() => setOpenEntry(null)}
      />
    );
  }

  return (
    <>
      <header className="mb-3">
        <div className="flex items-center gap-2">
          <CodexWebIcon name="permission" size="sm" className="text-muted-foreground" aria-hidden />
          <h4 className="text-sm font-medium">
            {t("mcp.builtin.sectionTitle" as TranslationKey)}
          </h4>
          <span className="text-xs text-muted-foreground">
            ({visible.length}
            {query && visible.length !== BUILTIN_MCP_CATALOG.length
              ? ` / ${BUILTIN_MCP_CATALOG.length}`
              : ""}
            )
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          {t("mcp.builtin.sectionDescription" as TranslationKey)}
        </p>
      </header>

      {/* Two-col grid from md breakpoint, mirrors `OverviewSection.tsx`'s
          `grid grid-cols-1 md:grid-cols-2 gap-4` for visual parity with
          the rest of the Settings shell. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {visible.map((entry) => (
          <BuiltInMcpCard
            key={entry.name}
            entry={entry}
            onOpenDetail={() => setOpenEntry(entry)}
          />
        ))}
      </div>

      <BuiltInMcpDetailDialog
        entry={openEntry}
        onClose={() => setOpenEntry(null)}
      />
    </>
  );
}

function BuiltInMcpCard({
  entry,
  onOpenDetail,
}: {
  entry: BuiltInMcpEntry;
  onOpenDetail: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      aria-label={`${entry.name} — ${t(entry.descriptionKey as TranslationKey)}`}
      // Canonical settings card: rounded-lg + soft border + p-5, no shadow.
      // Adds cursor + hover/focus affordances for the click-to-open detail.
      // Clickable cards (open detail dialog) get a subtle hover wash so
      // the affordance is visible. Non-clickable cards (external MCP
      // server list) intentionally stay flat — see McpServerList.tsx.
      className="rounded-lg bg-card border border-border/50 p-5 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium font-mono">{entry.name}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
            TRIGGER_TONE[entry.triggerCondition],
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              TRIGGER_DOT_TONE[entry.triggerCondition],
            )}
          />
          {t(TRIGGER_LABEL_KEY[entry.triggerCondition])}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {entry.toolNames.length}{" "}
          {t("mcp.builtin.toolCount" as TranslationKey)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
        {t(entry.descriptionKey as TranslationKey)}
      </p>
    </div>
  );
}

function BuiltInMcpDetailDialog({
  entry,
  onClose,
}: {
  entry: BuiltInMcpEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden">
        {entry && (
          <>
            <DialogHeader className="shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base font-medium font-mono">
                  {entry.name}
                </DialogTitle>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    TRIGGER_TONE[entry.triggerCondition],
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      TRIGGER_DOT_TONE[entry.triggerCondition],
                    )}
                  />
                  {t(TRIGGER_LABEL_KEY[entry.triggerCondition])}
                </span>
              </div>
              <DialogDescription className="text-xs leading-relaxed pt-1">
                {t(entry.descriptionKey as TranslationKey)}
              </DialogDescription>
            </DialogHeader>

            {/* Single-scroll body — `flex-1 min-h-0 overflow-y-auto`
                is the canonical pattern from `docs/design.md` §
                "Card → Detail dialog". */}
            <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4">
              {entry.triggerHintKey && (
                <section>
                  <h5 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                    {t("mcp.builtin.triggerHeading" as TranslationKey)}
                  </h5>
                  <p className="text-xs leading-relaxed">
                    {t(entry.triggerHintKey as TranslationKey)}
                  </p>
                </section>
              )}

              <section>
                <h5 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t("mcp.builtin.toolsHeading" as TranslationKey)} ·{" "}
                  {entry.toolNames.length}
                </h5>
                {/* Inset-divider sub-card per design.md card system §
                    "rounded-md bg-muted/40 + px-3.5 + divide-y". */}
                <div className="rounded-md bg-muted/40">
                  <ul className="px-3.5 divide-y divide-border/50">
                    {entry.toolNames.map((toolName) => (
                      <li
                        key={toolName}
                        className="py-2 font-mono text-[11px] text-foreground/80"
                      >
                        {toolName}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
