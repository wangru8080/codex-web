'use client';

/**
 * Top Tab strip for the right-side Workspace Sidebar.
 *
 * Visual order:
 *   [git] · [dynamic 1] [dynamic 2] ... · [collapse]
 *
 * Fixed Tabs are never closable. Dynamic Tabs render an `X` close
 * button on hover/focus. The shell collapse button sits at the very
 * right of the strip.
 *
 * Accessibility (Codex P3 finding 2026-04-30):
 *   - The Tab row is `role="tablist"`; each Tab is a `<button role="tab">`
 *     with `aria-selected` and managed `tabIndex` (active = 0,
 *     others = -1) so screen readers announce "selected" and keyboard
 *     focus follows the active Tab on first tab-into.
 *   - ArrowLeft / ArrowRight cycle focus + activate Tabs (WAI-ARIA
 *     Tabs pattern). Home / End jump to first / last.
 *   - Close button aria-labels include the Tab name so a screen reader
 *     hears "Close Git" rather than just "Close tab".
 */

import { useCallback, useRef, useState } from 'react';
import { Plus, X } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import { WORKSPACE_HOME_TAB_ID, type Tab } from '@/lib/workspace-sidebar';

interface TabBarProps {
  className?: string;
}

function tabLabel(tab: Tab, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  if (tab.kind === 'fixed') {
    return t('workspaceSidebar.tab.git' as TranslationKey);
  }
  if (tab.kind === 'files-pinned') return t('workspaceSidebar.tab.openFile' as TranslationKey);
  if (tab.kind === 'terminal-pinned') return t('workspaceSidebar.tool.terminal' as TranslationKey);
  return tab.title;
}

function tabIcon(tab: Tab): React.ReactNode {
  // Phase 4 UX v5 — icons scaled from 14 → 16 to match the size-4
  // (16px) icons inside SelectTrigger / TabsTrigger in the file-info
  // row. Tab strip + file-info row now read at the same density.
  //
  // Phase 7 color rule (2026-05-21): tab leading icons use
  // `text-inherit` so they follow the tab pill's text color —
  // inactive tab pill is `text-muted-foreground` (light), active is
  // `text-foreground` (dark). Without `text-inherit` the CodexWebIcon
  // default (`text-muted-foreground`) would lock every leading icon to
  // light even when its tab is active, breaking the "selected → dark"
  // half of the color rule.
  if (tab.kind === 'fixed') {
    return <CodexWebIcon name="git" size="md" className="text-inherit" aria-hidden />;
  }
  if (tab.kind === 'files-pinned') return <CodexWebIcon name="pin" size="md" className="text-inherit" aria-hidden />;
  if (tab.kind === 'terminal-pinned') return <CodexWebIcon name="terminal" size="md" className="text-inherit" aria-hidden />;
  if (tab.kind === 'side-chat') return <CodexWebIcon name="chat" size="md" className="text-inherit" aria-hidden />;
  if (tab.kind === 'markdown' || tab.kind === 'file') {
    const ext = (tab.kind === 'markdown' ? '.md' : tab.filePath.split('.').pop() || '').toLowerCase();
    if (ext.endsWith('.md') || tab.kind === 'markdown') return <CodexWebIcon name="file" size="md" className="text-inherit" aria-hidden />;
    if (['.ts', '.tsx', '.js', '.jsx', '.py'].includes(`.${ext}`)) return <CodexWebIcon name="code" size="md" className="text-inherit" aria-hidden />;
    return <CodexWebIcon name="file_code" size="md" className="text-inherit" aria-hidden />;
  }
  // artifact
  return <CodexWebIcon name="folder_open" size="md" className="text-inherit" aria-hidden />;
}

const SIDE_CHAT_CLOSE_CONFIRMATION_KEY = 'codex-web:side-chat:skip-close-confirmation';

export function TabBar({ className }: TabBarProps) {
  const { state, setActiveTab, closeTab, setOpen, openTab, openSideChat, closeSideChat } = useWorkspaceSidebar();
  const { t } = useTranslation();
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [sideCloseOpen, setSideCloseOpen] = useState(false);
  const [sideCloseTargetId, setSideCloseTargetId] = useState<string | null>(null);
  const [skipSideCloseConfirmation, setSkipSideCloseConfirmation] = useState(false);
  const [sideClosePending, setSideClosePending] = useState(false);
  const [sideCloseError, setSideCloseError] = useState<string | null>(null);
  // Refs to each Tab button so ArrowLeft/ArrowRight focus moves keep
  // the visual focus ring in sync with `activeTabId`.
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const performSideClose = useCallback(async (sideChatId: string) => {
    setSideClosePending(true);
    setSideCloseError(null);
    try {
      await closeSideChat(sideChatId);
      if (skipSideCloseConfirmation) {
        localStorage.setItem(SIDE_CHAT_CLOSE_CONFIRMATION_KEY, 'true');
      }
      setSideCloseOpen(false);
      setSideCloseTargetId(null);
    } catch (error) {
      setSideCloseError(error instanceof Error ? error.message : String(error));
      setSideCloseTargetId(sideChatId);
      setSideCloseOpen(true);
    } finally {
      setSideClosePending(false);
    }
  }, [closeSideChat, skipSideCloseConfirmation]);

  const requestTabClose = useCallback((tab: Tab) => {
    if (tab.kind !== 'side-chat') {
      closeTab(tab.id);
      return;
    }
    setSideCloseTargetId(tab.id);
    if (localStorage.getItem(SIDE_CHAT_CLOSE_CONFIRMATION_KEY) === 'true') {
      void performSideClose(tab.id);
      return;
    }
    setSideCloseError(null);
    setSideCloseOpen(true);
  }, [closeTab, performSideClose]);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentId: string) => {
      const tabs = state.tabs;
      const idx = tabs.findIndex((t) => t.id === currentId);
      if (idx === -1) return;
      let nextIdx = idx;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      else return;
      e.preventDefault();
      const nextId = tabs[nextIdx]?.id;
      if (!nextId) return;
      setActiveTab(nextId);
      // Move keyboard focus to the newly-activated Tab so the WAI-ARIA
      // automatic-activation Tabs pattern feels natural.
      requestAnimationFrame(() => {
        tabRefs.current.get(nextId)?.focus();
      });
    },
    [state.tabs, setActiveTab],
  );

  // Phase 4 UX (Codex feedback): the collapse button used to live
  // inside the same `overflow-x-auto` scroller as the Tabs. When the
  // user opened enough tabs to overflow, the collapse button got
  // pushed off the right edge and became unreachable. Now we split
  // the row in two: an inner `role="tablist"` div that scrolls
  // horizontally for the Tabs, and a fixed `shrink-0` collapse
  // button sibling that stays pinned at the far right regardless of
  // how many tabs are open.
  // Phase 4 UX v3 (Codex feedback):
  //  - Bar is taller (h-9) so tabs are easier to hit.
  //  - `border-b` removed; the divider now lives BELOW the file-info
  //    row in PreviewPanel, so Tab strip + file info read as one
  //    contiguous header zone separated only by spacing.
  //  - No `overflow-x-auto`: dynamic tabs shrink browser-style when
  //    the strip gets crowded. The fixed Git Tab keeps a fixed
  //    width so they're always reachable.
  //  - Close is folded INTO the leading icon: hovering the tab swaps
  //    the file icon for an X; clicking the icon while hovered closes
  //    the tab. Removes the dedicated X button → ~16px back per tab.
  // Phase 4 UX v4:
  //   - py-1.5 → pt-1.5 pb-3 to put 12px breathing room (design.md
  //     row-gap token) between the Tab strip and the file-info row
  //     below it. Tab buttons themselves are taller now so the bar
  //     also reads as a real toolbar, not a thin strip.
  return (
    <div
      className={cn(
        // Right rail is opaque again (round 5) — TabBar inherits the
        // parent's bg-background by going transparent itself.
        'flex shrink-0 items-center bg-transparent px-2 pt-1.5 pb-3',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label={t('workspaceSidebar.toggle' as TranslationKey)}
        aria-orientation="horizontal"
        className="flex min-w-0 flex-1 items-center gap-0.5"
        data-workspace-sidebar-tabbar
      >
      {state.tabs.map((tab) => {
        const isActive = tab.id === state.activeTabId;
        const closable = tab.kind !== 'fixed';
        const label = tabLabel(tab, t);
        return (
          <TabItem
            key={tab.id}
            tab={tab}
            label={label}
            isActive={isActive}
            isFocusable={isActive || (state.activeTabId === WORKSPACE_HOME_TAB_ID && tab.id === 'git')}
            closable={closable}
            tabRefs={tabRefs}
            onActivate={() => setActiveTab(tab.id)}
            onClose={() => requestTabClose(tab)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            closeAriaLabel={t('workspaceSidebar.closeTabNamed' as TranslationKey, { name: label })}
          />
        );
      })}
      <Popover open={toolMenuOpen} onOpenChange={setToolMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('workspaceSidebar.addTab' as TranslationKey)}
            className="ml-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Plus size={15} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-52 gap-1 rounded-xl p-1.5">
          <ToolMenuItem
            icon="terminal"
            label={t('workspaceSidebar.tool.terminal' as TranslationKey)}
            onClick={() => {
              openTab({
                id: 'terminal-pinned',
                kind: 'terminal-pinned',
                key: 'terminal',
                title: t('workspaceSidebar.tool.terminal' as TranslationKey),
              });
              setToolMenuOpen(false);
            }}
          />
          <ToolMenuItem
            icon="chat"
            label={t('workspaceSidebar.tool.sideChat' as TranslationKey)}
            onClick={() => {
              openSideChat(t('workspaceSidebar.tool.sideChat' as TranslationKey));
              setToolMenuOpen(false);
            }}
          />
          <ToolMenuItem
            icon="file_tree"
            label={t('workspaceSidebar.tool.files' as TranslationKey)}
            onClick={() => {
              openTab({
                id: 'files-pinned',
                kind: 'files-pinned',
                key: 'files',
                title: t('workspaceSidebar.tab.openFile' as TranslationKey),
              });
              setToolMenuOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(false)}
        aria-label={t('workspaceSidebar.collapse' as TranslationKey)}
        className="shrink-0 ml-1"
      >
        <X size={14} />
        <span className="sr-only">{t('workspaceSidebar.collapse' as TranslationKey)}</span>
      </Button>
      <AlertDialog open={sideCloseOpen} onOpenChange={(open) => {
        if (sideClosePending) return;
        setSideCloseOpen(open);
        if (!open) setSideCloseTargetId(null);
      }}>
        <AlertDialogContent className="max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('workspaceSidebar.sideChat.closeTitle' as TranslationKey)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('workspaceSidebar.sideChat.closeDescription' as TranslationKey)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={skipSideCloseConfirmation}
              onChange={(event) => setSkipSideCloseConfirmation(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-foreground"
            />
            {t('workspaceSidebar.sideChat.doNotAskAgain' as TranslationKey)}
          </label>
          {sideCloseError && <p className="text-sm text-destructive" role="alert">{sideCloseError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sideClosePending}>
              {t('workspaceSidebar.sideChat.cancel' as TranslationKey)}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={sideClosePending}
              onClick={(event) => {
                event.preventDefault();
                if (sideCloseTargetId) void performSideClose(sideCloseTargetId);
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t('workspaceSidebar.sideChat.closeAction' as TranslationKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToolMenuItem({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: 'terminal' | 'chat' | 'file_tree';
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CodexWebIcon name={icon} size="sm" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/**
 * One tab in the strip. Phase 4 UX v3 split this out of the main
 * render so the per-tab interaction logic (hover-icon-becomes-X,
 * fixed vs dynamic width) stays readable.
 *
 * Width rules:
 *  - Fixed Git tab: `shrink-0` + content-width so it
 *    always show their full label and are first-priority to click.
 *  - Dynamic tabs: `flex-1 min-w-[40px] max-w-[160px]` so they
 *    share remaining width browser-style. Each tab can shrink down
 *    to the leading icon + a few characters of the label;
 *    `min-w-[40px]` keeps the icon hitbox usable.
 *
 * Close UX:
 *  - The leading icon span is itself a button (when `closable`).
 *  - On hover (or when the tab is active), the file icon is swapped
 *    for an X. Clicking the icon then closes; clicking anywhere
 *    else in the tab activates as usual.
 *  - `aria-label` distinguishes activate-tab vs close-tab.
 */
function TabItem({
  tab,
  label,
  isActive,
  isFocusable,
  closable,
  tabRefs,
  onActivate,
  onClose,
  onKeyDown,
  closeAriaLabel,
}: {
  tab: Tab;
  label: string;
  isActive: boolean;
  isFocusable: boolean;
  closable: boolean;
  tabRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  onActivate: () => void;
  onClose: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  closeAriaLabel: string;
}) {
  return (
    <div
      className={cn(
        // Phase 4 UX v5 — text-sm to match size-sm controls (14px)
        // below in the file-info row. text-xs at 12px was visibly
        // smaller than the file-info row's text-sm.
        // v6 — rounded-full so the hover / active fill reads as a
        // capsule, not a rectangle. Tab height grew to ~32px but
        // the corner radius stayed at rounded-md (6px), making the
        // pill look unintentionally squared off.
        'group flex items-center rounded-full text-sm transition-colors',
        // Fixed tabs always claim their own width; dynamic tabs share
        // the rest. min-w guarantees the icon stays clickable; max-w
        // caps the longest tab so a runaway filename doesn't crowd
        // out the rest of the strip.
        tab.kind === 'fixed'
          ? 'shrink-0'
          : 'min-w-[40px] max-w-[160px] flex-1',
        isActive
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
      data-tab-id={tab.id}
      data-tab-active={isActive || undefined}
    >
      <button
        type="button"
        id={`tab-${tab.id}`}
        role="tab"
        aria-selected={isActive}
        aria-controls="workspace-sidebar-tabpanel"
        tabIndex={isFocusable ? 0 : -1}
        ref={(el) => {
          if (el) tabRefs.current.set(tab.id, el);
          else tabRefs.current.delete(tab.id);
        }}
        // Phase 4 UX v4-v5 — tab button at py-2 (h-8 total). v5: also
        // px-3 (match SelectTrigger's px-3 horizontal padding) so the
        // tab proportions feel like the size-sm controls below, not
        // a stretched-vertically pill.
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full py-2 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={(e) => {
          // Click on the leading icon while hovering or focused →
          // close. Anywhere else → activate.
          const target = e.target as HTMLElement;
          if (closable && target.closest('[data-codepilot-tab-leading]')) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          onActivate();
        }}
        onKeyDown={onKeyDown}
      >
        {/* Leading icon — becomes the X target on hover for closable
            tabs. Fixed tabs (no close) just render the icon. */}
        {closable ? (
          <span
            data-codepilot-tab-leading
            aria-label={closeAriaLabel}
            role="button"
            className="relative flex h-4 w-4 shrink-0 items-center justify-center text-inherit"
          >
            <span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
              {tabIcon(tab)}
            </span>
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <CodexWebIcon name="cancel" size="md" strokeWidth={2} aria-hidden />
            </span>
          </span>
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-inherit">
            {tabIcon(tab)}
          </span>
        )}
        <span className="min-w-0 truncate">{label}</span>
      </button>
    </div>
  );
}
