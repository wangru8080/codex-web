"use client";

/**
 * MCP JSON-config dialog (Phase 2D.4 P2, 2026-05-01).
 *
 * Replaces the old "List / JSON" Tabs that lived inside McpManager —
 * the JSON view is a low-frequency advanced surface, so it now sits
 * behind the ExtensionsPage More menu instead of competing with the
 * page-level filter pills.
 *
 * The dialog fetches MCP config directly from `/api/plugins/mcp` rather
 * than reading from a parent ref, so it works regardless of which
 * filter tab is currently mounted (Phase 2D.4 P2 fix, 2026-05-01).
 * Earlier versions read from `mcpRef.current?.getServers()`, which
 * silently returned `{}` on Skills/CLI tabs because `<McpManager>` was
 * not mounted there.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfigEditor } from "./ConfigEditor";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { MCPServer } from "@/types";

type ServerWithSource = MCPServer & { _source?: string };

interface McpJsonConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback so the host page can refresh its own state when
   *  the user saves (e.g. McpManager re-fetches on next mount). */
  onSaved?: () => void;
}

export function McpJsonConfigDialog({
  open,
  onOpenChange,
  onSaved,
}: McpJsonConfigDialogProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<Record<string, ServerWithSource> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch on every open so the editor shows current state, even when
  // the MCP manager is not mounted (Skills / CLI filter tabs).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    fetch("/api/plugins/mcp")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data?.mcpServers ?? {});
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      });
    return () => { cancelled = true; };
  }, [open]);

  const handleSave = async (json: string) => {
    let parsed: Record<string, ServerWithSource>;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      setError(`${t("mcp.editor.error.jsonInvalid" as TranslationKey)}: ${(err as Error).message}`);
      return;
    }

    // Preserve _source on existing entries, treat new entries as
    // settings.json (the default editable surface). Mirrors the legacy
    // McpManager.handleJsonSave logic so behavior is unchanged.
    const next: Record<string, ServerWithSource> = {};
    for (const [name, server] of Object.entries(parsed)) {
      const existing = snapshot?.[name];
      if (existing?._source) {
        next[name] = { ...server, _source: existing._source };
      } else {
        next[name] = { ...server, _source: "settings.json" };
      }
    }
    // Carry forward claude.json-sourced servers untouched (the editor
    // hides them; we filter them out of the JSON view but keep the
    // underlying state intact).
    if (snapshot) {
      for (const [name, server] of Object.entries(snapshot)) {
        if (server._source === "claude.json" && !next[name]) {
          next[name] = server;
        }
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/plugins/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      onSaved?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const claudeJsonNoticeNeeded =
    !!snapshot && Object.values(snapshot).some((s) => s._source === "claude.json");

  const editableJson = snapshot
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(snapshot)
            .filter(([, v]) => v._source !== "claude.json")
            .map(([k, v]) => {
              const { _source: _unused, ...rest } = v; // eslint-disable-line @typescript-eslint/no-unused-vars
              return [k, rest];
            }),
        ),
        null,
        2,
      )
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-base font-medium">
            {t("plugins.more.mcpJson" as TranslationKey)}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("plugins.more.mcpJson.description" as TranslationKey)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 mt-3 flex flex-col gap-3 overflow-hidden">
          {claudeJsonNoticeNeeded && (
            <p className="text-xs text-muted-foreground shrink-0">
              {t("mcp.claudeJsonNotice" as TranslationKey)}
            </p>
          )}
          {error && (
            <p className="text-xs text-status-error-foreground shrink-0">
              {error}
            </p>
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            {snapshot === null && !error ? (
              <div className="flex items-center justify-center py-8">
                <SpinnerGap size={18} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ConfigEditor
                value={editableJson}
                onSave={handleSave}
                saving={saving}
                label={t("mcp.serverConfig" as TranslationKey)}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
