"use client";

import { Lock, Trash } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

export type SkillSource = "global" | "project" | "plugin" | "installed" | "sdk";
export type SkillReadOnlyReason = "sdk" | "file_not_writable" | "out_of_cwd";

export interface SkillItem {
  name: string;
  description: string;
  content: string;
  source: SkillSource;
  installedSource?: "agents" | "claude";
  filePath: string;
  /**
   * Whether this skill row is editable in the manager UI. Driven entirely
   * by `/api/skills` (Phase 2D.1) — the client must not re-derive.
   */
  editable?: boolean;
  /**
   * Why a row is read-only; only present when `editable === false`.
   */
  readOnlyReason?: SkillReadOnlyReason;
  /** Whether this plugin skill is loaded for the current session. */
  loaded?: boolean;
}

interface SkillListItemProps {
  skill: SkillItem;
  selected: boolean;
  onSelect: () => void;
  onDelete: (skill: SkillItem) => void;
}

export function SkillListItem({
  skill,
  selected,
  onSelect,
  onDelete,
}: SkillListItemProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Server-driven: api/skills annotates editable + readOnlyReason. Default
  // editable=true preserves the pre-2D.1 behavior for any code path that
  // hasn't been re-fetched yet.
  const editable = skill.editable !== false;
  const readOnlyReasonKey: TranslationKey | null =
    skill.readOnlyReason === "sdk"
      ? "skills.readOnlyReason.sdk"
      : skill.readOnlyReason === "file_not_writable"
        ? "skills.readOnlyReason.fileNotWritable"
        : skill.readOnlyReason === "out_of_cwd"
          ? "skills.readOnlyReason.outOfCwd"
          : null;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    if (confirmDelete) {
      onDelete(skill);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
    >
      <CodexWebIcon name="skill" size="md" className="shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">/{skill.name}</span>
        <p className="text-xs text-muted-foreground truncate">
          {skill.description}
        </p>
      </div>
      {/* Read-only badge: surfaces SDK / out-of-cwd / file-not-writable
          reasons so users understand why delete isn't offered. */}
      {!editable && readOnlyReasonKey && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="shrink-0 text-muted-foreground/70"
              aria-label={t(readOnlyReasonKey)}
            >
              <Lock size={12} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{t(readOnlyReasonKey)}</TooltipContent>
        </Tooltip>
      )}
      {editable && (hovered || confirmDelete) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={confirmDelete ? "destructive" : "ghost"}
              size="icon-xs"
              className="shrink-0"
              onClick={handleDelete}
            >
              <Trash size={12} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {confirmDelete ? t('skills.deleteConfirm') : t('common.delete')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
