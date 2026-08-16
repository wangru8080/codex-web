"use client";

import {
  CaretDown,
  CaretRight,
  FolderMinus,
  DotsThree,
} from "@/components/ui/icon";
import { PushPinSlash } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslation } from '@/hooks/useTranslation';
import { copyWithToast } from "@/lib/clipboard";
import type { TranslationKey } from "@/i18n";
import { useState } from "react";
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, type Species } from "@/lib/buddy";

interface ProjectGroupHeaderProps {
  workingDirectory: string;
  displayName: string;
  isCollapsed: boolean;
  isFolderHovered: boolean;
  isWorkspace: boolean;
  /** Hide the caret/chevron prefix (Codex-style flat folders, expansion indicated by Folder/FolderOpen icon swap only). */
  hideCaret?: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onCreateSession: (e: React.MouseEvent) => void;
  isPinned?: boolean;
  onTogglePin?: (workingDirectory: string) => void;
  onRemoveProject?: (workingDirectory: string) => void;
  assistantName?: string;
  assistantMemoryCount?: number;
  lastHeartbeatDate?: string;
  buddyEmoji?: string;
  buddyName?: string;
  buddySpecies?: string;
}

export function ProjectGroupHeader({
  workingDirectory,
  displayName,
  isCollapsed,
  isFolderHovered,
  isWorkspace,
  hideCaret = false,
  onToggle,
  onMouseEnter,
  onMouseLeave,
  onCreateSession,
  isPinned = false,
  onTogglePin,
  onRemoveProject,
  assistantName,
  assistantMemoryCount,
  lastHeartbeatDate,
  buddyEmoji,
  buddyName,
  buddySpecies,
}: ProjectGroupHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = isFolderHovered || menuOpen;

  const actionButtons = workingDirectory !== "" && (
    <div className={cn(
      "flex items-center gap-0.5 transition-opacity",
      showActions ? "opacity-100" : "opacity-0 pointer-events-none"
    )}>
      {/* New chat button — a "写新对话" pencil/compose icon (clearer than a
          bare +, which read ambiguously as "add what?"). */}
      <Button
        variant="ghost"
        size="icon-xs"
        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
        tabIndex={showActions ? 0 : -1}
        onClick={onCreateSession}
        title={t('chatList.newConversation')}
      >
        <CodexWebIcon name="edit" size="sm" aria-hidden />
      </Button>
      {/* Three-dot menu */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
            tabIndex={showActions ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <DotsThree size={14} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
          {onTogglePin && (
            <DropdownMenuItem onClick={() => onTogglePin(workingDirectory)}>
              {isPinned
                ? <PushPinSlash size={14} />
                : <CodexWebIcon name="pin" size="sm" aria-hidden />}
              <span>{t((isPinned ? 'chatList.unpinProject' : 'chatList.pinProject') as TranslationKey)}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => {
            // v11 fix — see lib/clipboard.ts for why fire-and-forget
            // Clipboard access can fail after the dropdown loses focus.
            void copyWithToast({ text: workingDirectory, t });
          }}>
            <CodexWebIcon name="copy" size="sm" aria-hidden />
            <span>{t('chatList.copyFolderPath' as TranslationKey)}</span>
          </DropdownMenuItem>
          {onRemoveProject && !isWorkspace && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemoveProject(workingDirectory)}
              >
                <FolderMinus size={14} />
                <span>{t('chatList.removeProject' as TranslationKey)}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  if (isWorkspace) {
    const statusParts: string[] = [];
    if (assistantMemoryCount) {
      statusParts.push(t('assistant.memoryCount' as TranslationKey, { count: String(assistantMemoryCount) }));
    }
    if (lastHeartbeatDate) {
      statusParts.push(t('assistant.lastHeartbeat' as TranslationKey, { date: lastHeartbeatDate }));
    }

    const folderName = displayName;
    const nameDisplay = buddyEmoji
      ? (buddyName || assistantName || t('assistant.defaultName' as TranslationKey))
      : t('buddy.adoptPrompt' as TranslationKey);

    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer select-none transition-colors",
          isCollapsed
            ? "hover:bg-accent/50"
            : "bg-primary/[0.06] hover:bg-primary/[0.10]"
        )}
        onClick={onToggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {buddySpecies ? (
          <img
            src={SPECIES_IMAGE_URL[buddySpecies as Species] || ''}
            alt="" width={24} height={24}
            className="shrink-0 rounded"
          />
        ) : (
          <img src={EGG_IMAGE_URL} alt="egg" width={24} height={24} className="shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate text-[13px] font-medium text-sidebar-foreground">
              {nameDisplay}
            </span>
            {isCollapsed ? (
              <CaretRight size={12} className="shrink-0 text-muted-foreground" />
            ) : (
              <CaretDown size={12} className="shrink-0 text-muted-foreground" />
            )}
          </div>
          <span className="block truncate text-[11px] text-muted-foreground/50 leading-tight">
            / {folderName}
          </span>
        </div>
        {actionButtons}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 h-8 cursor-pointer select-none transition-colors",
        "hover:bg-sidebar-accent"
      )}
      onClick={onToggle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {!hideCaret && (
        isCollapsed ? (
          <CaretRight size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <CaretDown size={14} className="shrink-0 text-muted-foreground" />
        )
      )}
      {isCollapsed ? (
        <CodexWebIcon name="folder" size="md" className="shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <CodexWebIcon name="folder_open" size="md" className="shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="flex-1 truncate text-[13px] font-normal text-sidebar-foreground/70">
        {displayName}
      </span>
      {actionButtons}
    </div>
  );
}
