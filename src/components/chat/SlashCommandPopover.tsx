'use client';

import { NotePencil, GlobeSimple, Folder, File } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PopoverItem, PopoverMode } from '@/types';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
} from '@/components/patterns';

export type { PopoverItem, PopoverMode } from '@/types';

// Codex-style attached card: drops the in-popover search bar and the
// "manage shortcut" footer per April 2026 feedback. Filtering is driven
// from textarea content (handleInputChange in useSlashCommands), and
// keyboard nav comes from MessageInput's textarea handleKeyDown — the
// popover is purely presentational here.
interface SlashCommandPopoverProps {
  popoverMode: PopoverMode;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  filteredItems: PopoverItem[];
  aiSuggestions: PopoverItem[];
  aiSearchLoading: boolean;
  selectedIndex: number;
  allDisplayedItems: PopoverItem[];
  onInsertItem: (item: PopoverItem) => void;
  onSetSelectedIndex: (index: number) => void;
}

export function SlashCommandPopover({
  popoverMode,
  popoverRef,
  filteredItems,
  aiSuggestions,
  aiSearchLoading,
  selectedIndex,
  allDisplayedItems,
  onInsertItem,
  onSetSelectedIndex,
}: SlashCommandPopoverProps) {
  const { t } = useTranslation();

  const builtInItems = filteredItems.filter(item => item.builtIn);
  const slashCommandItems = filteredItems.filter(item => !item.builtIn && item.kind !== 'agent_skill');
  const agentSkillItems = filteredItems.filter(item => !item.builtIn && item.kind === 'agent_skill');
  let globalIdx = 0;

  const renderItem = (item: PopoverItem, idx: number) => (
    <CommandListItem
      key={`${idx}-${item.value}`}
      active={idx === selectedIndex}
      itemRef={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
      onClick={() => onInsertItem(item)}
      onMouseEnter={() => onSetSelectedIndex(idx)}
    >
      {popoverMode === 'file' ? (
        item.nodeType === 'directory'
          ? <Folder size={16} className="shrink-0 text-muted-foreground" />
          : <File size={16} className="shrink-0 text-muted-foreground" />
      ) : item.builtIn && item.iconName ? (
        <CodexWebIcon name={item.iconName} size="md" className="shrink-0 text-muted-foreground" aria-hidden />
      ) : item.kind === 'agent_skill' ? (
        <CodexWebIcon name="skill" size="md" className="shrink-0 text-muted-foreground" />
      ) : item.kind === 'slash_command' ? (
        <NotePencil size={16} className="shrink-0 text-muted-foreground" />
      ) : !item.builtIn ? (
        <GlobeSimple size={16} className="shrink-0 text-muted-foreground" />
      ) : (
        <CodexWebIcon name="terminal" size="md" className="shrink-0 text-muted-foreground" />
      )}
      <span className="font-mono text-xs truncate">{item.display || item.label}</span>
      {(item.descriptionKey || item.description) && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {item.descriptionKey ? t(item.descriptionKey) : item.description}
        </span>
      )}
      {!item.builtIn && item.installedSource && (
        <span className="text-xs text-muted-foreground shrink-0 ml-auto">
          {item.installedSource === 'claude' ? 'Personal' : 'Agents'}
        </span>
      )}
    </CommandListItem>
  );

  if (!popoverMode || popoverMode === 'cli') return null;
  if (allDisplayedItems.length === 0 && !aiSearchLoading) return null;

  return (
    <div ref={popoverRef}>
      <CommandList className="w-full">
        <CommandListItems className="max-h-72">
          {popoverMode === 'file' ? (
            <CommandListGroup label={t('globalSearch.files' as TranslationKey)}>
              {filteredItems.map((item, i) => renderItem(item, i))}
            </CommandListGroup>
          ) : (
            <>
              {builtInItems.length > 0 && (
                <CommandListGroup label="Commands">
                  {builtInItems.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
              {slashCommandItems.length > 0 && (
                <CommandListGroup label="Slash Commands">
                  {slashCommandItems.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
              {agentSkillItems.length > 0 && (
                <CommandListGroup label="Agent Skills">
                  {agentSkillItems.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
              {(aiSuggestions.length > 0 || aiSearchLoading) && (
                <CommandListGroup>
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <CodexWebIcon name="assistant" size="sm" />
                    {t('messageInput.aiSuggested')}
                    {aiSearchLoading && (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    )}
                  </div>
                  {aiSuggestions.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
            </>
          )}
        </CommandListItems>
      </CommandList>
    </div>
  );
}
