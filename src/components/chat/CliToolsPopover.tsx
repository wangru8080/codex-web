'use client';

import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { CliToolItem } from '@/types';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
  CommandListEmpty,
  CommandListFooterAction,
} from '@/components/patterns';

export type { CliToolItem } from '@/types';

// Codex-style attached card matching the slash-command popover (April
// 2026 feedback). No in-popover search bar, no "manage CLI" footer
// shortcut, full input width — keyboard nav is driven from the
// composer textarea.
interface CliToolsPopoverProps {
  popoverRef: React.RefObject<HTMLDivElement | null>;
  cliTools: CliToolItem[];
  selectedIndex: number;
  onSetSelectedIndex: (index: number) => void;
  onCliSelect: (tool: CliToolItem) => void;
  onClosePopover: () => void;
}

export function CliToolsPopover({
  popoverRef,
  cliTools,
  selectedIndex,
  onSetSelectedIndex,
  onCliSelect,
  onClosePopover,
}: CliToolsPopoverProps) {
  const { t } = useTranslation();

  return (
    <div ref={popoverRef}>
      <CommandList className="w-full">
        <CommandListItems className="max-h-72">
          {cliTools.length > 0 ? (
            cliTools.map((tool, idx) => (
              <CommandListItem
                key={tool.id}
                active={idx === selectedIndex}
                itemRef={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
                onClick={() => onCliSelect(tool)}
                onMouseEnter={() => onSetSelectedIndex(idx)}
              >
                <CodexWebIcon name="cli" size="md" className="shrink-0 text-muted-foreground" />
                <span className="font-medium text-xs truncate">{tool.name}</span>
                {tool.version && (
                  <span className="text-[10px] text-muted-foreground shrink-0">v{tool.version}</span>
                )}
                {tool.summary && (
                  <span className="text-xs text-muted-foreground truncate ml-auto max-w-[200px]">{tool.summary}</span>
                )}
              </CommandListItem>
            ))
          ) : (
            <CommandListEmpty>
              <p className="text-sm text-muted-foreground">{t('cliTools.noToolsDetected' as TranslationKey)}</p>
              <CommandListFooterAction onClick={() => { onClosePopover(); window.location.href = '/cli-tools'; }}>
                <span className="mt-2 text-xs text-primary hover:underline">
                  {t('cliTools.goInstall' as TranslationKey)}
                </span>
              </CommandListFooterAction>
            </CommandListEmpty>
          )}
        </CommandListItems>
      </CommandList>
    </div>
  );
}
