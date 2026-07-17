"use client";

/**
 * Read-only skill detail dialog. Replaces the legacy `SkillEditor`'s
 * MarkdownEditor surface — Phase 2D.1 P3 (2026-05-01) decision: the
 * inline editor was almost never used and added a Save path the API
 * still tolerates but no longer offers in the UI. To re-enable editing,
 * users edit the underlying file in their workspace and refresh.
 *
 * The dialog shows: name + source pill + read-only-reason pill (if any)
 * + description + the skill's full markdown (rendered, not editable)
 * + Delete button when the row is editable (file-backed, writable, in cwd).
 *
 * Card chrome and pill dialect mirror `docs/design.md` so this surface
 * reads as a peer of the MCP detail dialog and the Settings cards.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { SkillItem, SkillSource } from "./SkillListItem";

const SOURCE_LABEL_KEY: Record<SkillSource, TranslationKey> = {
  global: "skills.source.global",
  project: "skills.source.project",
  installed: "skills.source.installed",
  plugin: "skills.source.plugin",
  sdk: "skills.source.sdk",
};

const SOURCE_TONE: Record<SkillSource, string> = {
  global: "bg-status-success-muted text-status-success-foreground",
  project: "bg-primary/10 text-primary",
  installed: "bg-status-warning-muted text-status-warning-foreground",
  plugin: "bg-muted text-muted-foreground",
  sdk: "bg-muted text-muted-foreground",
};

const SOURCE_DOT: Record<SkillSource, string> = {
  global: "bg-status-success-foreground",
  project: "bg-primary",
  installed: "bg-status-warning-foreground",
  plugin: "bg-muted-foreground",
  sdk: "bg-muted-foreground",
};

interface SkillDetailDialogProps {
  skill: SkillItem | null;
  onClose: () => void;
  onDelete: (skill: SkillItem) => void;
  onToggle: (skill: SkillItem, enabled: boolean) => void;
  onTry: (skill: SkillItem) => void;
}

export function SkillDetailDialog({
  skill,
  onClose,
  onDelete,
  onToggle,
  onTry,
}: SkillDetailDialogProps) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the destructive-confirm state whenever the open skill changes
  // — otherwise navigating from one row to another would carry over a
  // primed delete from the previous selection.
  useEffect(() => {
    setConfirmDelete(false);
  }, [skill?.name, skill?.filePath]);

  if (!skill) {
    return (
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent />
      </Dialog>
    );
  }

  const editable = skill.editable !== false;
  const readOnlyReasonKey: TranslationKey | null =
    skill.readOnlyReason === "sdk"
      ? "skills.readOnlyReason.sdk"
      : skill.readOnlyReason === "file_not_writable"
        ? "skills.readOnlyReason.fileNotWritable"
        : skill.readOnlyReason === "out_of_cwd"
          ? "skills.readOnlyReason.outOfCwd"
          : null;

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    if (confirmDelete) {
      onDelete(skill);
      setConfirmDelete(false);
      onClose();
    } else {
      setConfirmDelete(true);
      // Auto-reset after 3s so users don't accidentally double-fire.
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Flex column: header pinned at top, scroll region in the middle,
          delete row pinned at bottom. Single scroll surface — earlier
          versions had nested overflow (outer dialog + inner markdown
          max-h-[40vh]) which silently clipped long bodies. */}
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2 flex-wrap pr-16">
            <DialogTitle className="text-base font-medium font-mono break-all">
              {skill.displayName || skill.name} <span className="font-sans font-normal text-muted-foreground">Skill</span>
            </DialogTitle>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0",
                SOURCE_TONE[skill.source],
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  SOURCE_DOT[skill.source],
                )}
              />
              {t(SOURCE_LABEL_KEY[skill.source])}
            </span>
            {readOnlyReasonKey && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                <CodexWebIcon name="permission" size={10} aria-hidden />
                {t(readOnlyReasonKey)}
              </span>
            )}
            <Switch
              className="ml-auto"
              checked={skill.enabled !== false}
              onCheckedChange={(enabled) => onToggle(skill, enabled)}
              aria-label={`${skill.enabled === false ? t('skills.enable') : t('skills.disable')} ${skill.displayName || skill.name}`}
            />
          </div>
          {skill.description && (
            <DialogDescription className="text-xs leading-relaxed pt-1">
              {skill.shortDescription || skill.description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4 pr-1 -mr-1">
          {skill.filePath && (
            <section>
              <h5 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("skills.filePathHeading" as TranslationKey)}
              </h5>
              <p
                className="text-[11px] font-mono text-muted-foreground break-all"
                title={skill.filePath}
              >
                {skill.filePath}
              </p>
            </section>
          )}

          {skill.content ? (
            <section>
              <h5 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("skills.contentHeading" as TranslationKey)}
              </h5>
              <div className="rounded-md bg-muted/40 p-4">
                {/* prose modifiers tame markdown that would otherwise blow
                    out the dialog: code blocks scroll horizontally, long
                    inline tokens / URLs wrap. */}
                <div className="prose prose-sm dark:prose-invert max-w-none text-xs break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words [&_a]:break-all [&_img]:max-w-full">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {skill.content}
                  </ReactMarkdown>
                </div>
              </div>
            </section>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t("skills.noContentBody" as TranslationKey)}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 shrink-0 border-t border-border/50 mt-2">
          {editable ? (
            <Button
              variant={confirmDelete ? "destructive" : "ghost"}
              size="sm"
              onClick={handleDeleteClick}
              className="gap-1.5"
            >
              <CodexWebIcon name="delete" size="sm" aria-hidden />
              {confirmDelete
                ? t("skills.uninstallConfirm")
                : t("skills.uninstall")}
            </Button>
          ) : <span />}
          <Button size="sm" className="gap-1.5" onClick={() => onTry(skill)}>
            <CodexWebIcon name="chat" size="sm" aria-hidden />
            {t("skills.tryNow")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
