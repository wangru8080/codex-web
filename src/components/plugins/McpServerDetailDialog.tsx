"use client";

/**
 * Detail / edit dialog for a user-installed MCP server.
 *
 * Same dialog, two views (no stacked dialogs):
 *   - 'detail' — name + transport pill + status pill + tool count,
 *                command / URL, full tools list (when connected),
 *                footer with 编辑 / 删除 buttons.
 *   - 'edit'   — `<McpServerEditorForm>` body, footer with 取消 /
 *                保存修改. The dialog header stays so the user can see
 *                they're still in the same context.
 *
 * Mirrors the marketplace inline-detail pattern: clicking 编辑 swaps
 * the body without closing or stacking another dialog. Delete
 * confirmation uses `<AlertDialog>` (radix) — that briefly stacks but
 * is the standard pattern for destructive confirms and matches the
 * rest of the app.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WifiHigh } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n";
import type { MCPServer } from "@/types";
import {
  McpServerEditorForm,
  type McpServerEditorFormHandle,
} from "./McpServerEditorForm";

export interface McpRuntimeStatusForDetail {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  serverInfo?: { name: string; version: string };
  tools?: { name: string; description?: string }[];
}

interface McpServerDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string | null;
  server: MCPServer | null;
  runtime?: McpRuntimeStatusForDetail | null;
  onSave: (name: string, server: MCPServer) => void;
  onDelete: (name: string) => void;
}

function getTransportInfo(server: MCPServer | null): { label: string; iconKind: 'wifi' | 'web' | 'disk'; color: string } {
  if (!server) return { label: "stdio", iconKind: "disk", color: "text-muted-foreground" };
  const type = server.type || "stdio";
  switch (type) {
    case "sse":
      return { label: "SSE", iconKind: "wifi", color: "text-primary" };
    case "http":
      return { label: "HTTP", iconKind: "web", color: "text-status-success-foreground" };
    default:
      return { label: "stdio", iconKind: "disk", color: "text-muted-foreground" };
  }
}

function getStatusPill(status: McpRuntimeStatusForDetail["status"]) {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "bg-status-success-muted text-status-success-foreground", dot: "bg-status-success-foreground" };
    case "failed":
      return { label: "Failed", tone: "bg-status-error-muted text-status-error-foreground", dot: "bg-status-error-foreground" };
    case "needs-auth":
      return { label: "Auth Required", tone: "bg-status-warning-muted text-status-warning-foreground", dot: "bg-status-warning-foreground" };
    case "pending":
      return { label: "Pending", tone: "bg-primary/10 text-primary", dot: "bg-primary" };
    case "disabled":
      return { label: "Disabled", tone: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
    default:
      return null;
  }
}

export function McpServerDetailDialog({
  open,
  onOpenChange,
  name,
  server,
  runtime,
  onSave,
  onDelete,
}: McpServerDetailDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"detail" | "edit">("detail");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const formRef = useRef<McpServerEditorFormHandle>(null);

  // Reset to detail view every time the dialog opens with a new server.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional: re-seed mode + form on open */
  useEffect(() => {
    if (open) {
      setMode("detail");
      setOpenCount((n) => n + 1);
    }
  }, [open, name]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!name || !server) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const transport = getTransportInfo(server);
  const statusPill = runtime ? getStatusPill(runtime.status) : null;
  const toolCount = runtime?.tools?.length ?? 0;
  const isDisabled = server.enabled === false;
  const commandLine = server.url
    ? server.url
    : `${server.command || ""} ${server.args?.join(" ") || ""}`.trim();

  const deleteConfirmTitle = t("mcp.detail.deleteConfirm.title" as TranslationKey).replace("{name}", name);
  const deleteConfirmDesc = t("mcp.detail.deleteConfirm.description" as TranslationKey).replace(/\{name\}/g, name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Canonical click-card detail dialog (`docs/design.md` §
          "Card → Detail dialog"): sm:max-w-2xl, max-h-[85vh], flex
          flex-col gap-0 overflow-hidden, default DialogContent padding,
          shrink-0 header / flex-1 body / shrink-0 footer with border-t. */}
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-base font-medium font-mono break-all">
              {name}
            </DialogTitle>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {transport.iconKind === 'wifi' ? (
                <WifiHigh size={10} className={transport.color} />
              ) : transport.iconKind === 'web' ? (
                <CodexWebIcon name="web_simple" size={10} className={transport.color} aria-hidden />
              ) : (
                <CodexWebIcon name="disk" size={10} className={transport.color} aria-hidden />
              )}
              {transport.label}
            </span>
            {statusPill && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  statusPill.tone,
                )}
              >
                <span className={cn("size-1.5 rounded-full", statusPill.dot)} />
                {statusPill.label}
              </span>
            )}
            {toolCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {toolCount} {t("mcp.toolCount" as TranslationKey)}
              </span>
            )}
          </div>
          {/* DialogDescription is required for a11y; in detail view it
              labels the command preview; in edit view we swap to the
              static editor description. */}
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            {mode === "edit"
              ? t("mcp.editorDescription" as TranslationKey)
              : t("mcp.detail.commandHeading" as TranslationKey)}
          </DialogDescription>
        </DialogHeader>

        {mode === "detail" ? (
          <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4">
            {isDisabled && (
              <p className="text-xs rounded-md bg-muted/40 px-3 py-2 text-muted-foreground leading-relaxed">
                {t("mcp.detail.disabled" as TranslationKey)}
              </p>
            )}

            <section>
              <p className="text-xs font-mono text-muted-foreground leading-relaxed break-all rounded-md bg-muted/40 px-3 py-2">
                {commandLine}
              </p>
            </section>

            <section>
              <h5 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("mcp.detail.toolsHeading" as TranslationKey)}
                {toolCount > 0 && ` · ${toolCount}`}
              </h5>
              {toolCount > 0 ? (
                <div className="rounded-md bg-muted/40">
                  <ul className="px-3.5 divide-y divide-border/50">
                    {runtime!.tools!.map((tool) => (
                      <li
                        key={tool.name}
                        className="py-2 font-mono text-[11px] text-foreground/80 break-all"
                      >
                        {tool.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  {t("mcp.detail.toolsUnavailable" as TranslationKey)}
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto mt-4">
            <McpServerEditorForm
              ref={formRef}
              initialName={name}
              initialServer={server}
              isEditing
              resetKey={openCount}
              onSave={(updatedName, updatedServer) => {
                onSave(updatedName, updatedServer);
                onOpenChange(false);
              }}
            />
          </div>
        )}

        <DialogFooter className="shrink-0 border-t border-border/50 pt-3 mt-2 sm:justify-between">
          {mode === "detail" ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <CodexWebIcon name="delete" size="sm" aria-hidden />
                {t("common.delete")}
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setMode("edit")}>
                <CodexWebIcon name="edit" size="sm" aria-hidden />
                {t("common.edit")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setMode("detail")}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={() => formRef.current?.submit()}>
                {t("mcp.saveChanges")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete(name);
                setConfirmDeleteOpen(false);
                onOpenChange(false);
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
