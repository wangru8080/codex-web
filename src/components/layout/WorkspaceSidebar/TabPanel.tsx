'use client';

/**
 * TabPanel — content router for the active Workspace Sidebar Tab.
 *
 * Phase 1 mounts the existing Inner components for fixed Tabs and a
 * `<PreviewPanel>` for dynamic file/markdown/artifact Tabs. Files Tab
 * (`files-pinned`) reuses `<FileTreePanel>` directly per the plan.
 *
 * Critical: dynamic Tabs (markdown/file/artifact) all share the single
 * `<PreviewPanel>` component which reads from PanelContext's
 * `previewSource`. The sync effect below writes the matching
 * PreviewSource into context whenever the active Tab changes — without
 * this, switching from `buddy.md` Tab to `claude.md` Tab leaves the
 * previous preview's content rendered. (Codex P1 finding 2026-04-30.)
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import { usePanel } from '@/hooks/usePanel';
import { previewSourceFromTab, WORKSPACE_HOME_TAB_ID, type Tab } from '@/lib/workspace-sidebar';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

const GitTabContent = dynamic(
  () => import('@/components/layout/panels/GitPanel').then((m) => ({ default: m.GitTabContent })),
  { ssr: false },
);
const PreviewPanel = dynamic(
  () => import('@/components/layout/panels/PreviewPanel').then((m) => ({ default: m.PreviewPanel })),
  { ssr: false },
);
const FileTreePanel = dynamic(
  () => import('@/components/layout/panels/FileTreePanel').then((m) => ({ default: m.FileTreePanel })),
  { ssr: false },
);
const TerminalPanel = dynamic(
  () => import('@/components/layout/WorkspaceSidebar/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
  { ssr: false },
);

function ActiveContent({ tab, hasFilesTab }: { tab: Tab; hasFilesTab: boolean }) {
  if (tab.kind === 'fixed') {
    return <GitTabContent />;
  }
  if (tab.kind === 'files-pinned') {
    // sidebar variant strips the legacy panel chrome (Pin / Close /
    // ResizeHandle / panel title) — the Tab strip's X owns close, the
    // shell owns resize, and Pin is meaningless because we're already
    // inside the sidebar. (Codex P2 收口 2026-04-30.)
    return <FileWorkspace />;
  }
  if (tab.kind === 'terminal-pinned') {
    return <TerminalPanel />;
  }
  // markdown / artifact / file all flow through PreviewPanel; the
  // panel reads previewSource from PanelContext (kept in sync by
  // openWorkspaceTab callers in MessageItem / FileTreePanel /
  // DiffSummary — see Track 4). sidebar variant strips the redundant
  // outer ResizeHandle / width / Close chrome.
  if (hasFilesTab && (tab.kind === 'file' || tab.kind === 'markdown')) {
    return <FileWorkspace />;
  }
  return <PreviewPanel variant="sidebar" />;
}

export function TabPanel() {
  const { state } = useWorkspaceSidebar();
  const { previewSource, setPreviewSource } = usePanel();
  const active = state.activeTabId === WORKSPACE_HOME_TAB_ID
    ? undefined
    : state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const hasFilesTab = state.tabs.some((tab) => tab.kind === 'files-pinned');

  // Sync PanelContext.previewSource to the active dynamic Tab. Skips
  // fixed / files-pinned Tabs (those don't drive the preview surface).
  // The dependency on `active?.id` means re-firing only when the active
  // Tab actually changes — repeated state updates that don't change the
  // active id (e.g. width drag) won't loop.
  useEffect(() => {
    if (!active) return;
    const desired = previewSourceFromTab(active);
    if (!desired) return;
    // Skip if context already matches (prevents the AppShell event
    // bridge from echoing back into another openTab call).
    if (previewSource && samePreviewSource(previewSource, desired)) return;
    setPreviewSource(desired);
    // Intentional: listen to active.id only. previewSource itself flips
    // post-effect, so including it (or active / setPreviewSource) would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  if (!active || active.id === 'home') {
    return (
      <div
        id="workspace-sidebar-tabpanel"
        role="tabpanel"
        tabIndex={0}
        className="flex min-h-0 flex-1 overflow-hidden focus-visible:outline-none"
        data-workspace-sidebar-home
      >
        <WorkspaceHome />
      </div>
    );
  }
  return (
    <div
      id="workspace-sidebar-tabpanel"
      role="tabpanel"
      aria-labelledby={`tab-${active.id}`}
      tabIndex={0}
      className="flex flex-1 min-h-0 overflow-hidden focus-visible:outline-none"
      data-workspace-sidebar-tabpanel
      data-tab-id={active.id}
    >
      <ActiveContent tab={active} hasFilesTab={hasFilesTab} />
    </div>
  );
}

function WorkspaceHome() {
  const { openTab, setActiveTab } = useWorkspaceSidebar();
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center px-8">
      <div className="w-full max-w-[240px] space-y-1">
        <button type="button" className="flex h-10 w-full items-center gap-3 rounded-md px-2 text-sm text-foreground hover:bg-muted" onClick={() => setActiveTab('git')}>
          <CodexWebIcon name="git" size="sm" aria-hidden />
          <span>{t('workspaceSidebar.home.review' as TranslationKey)}</span>
        </button>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-3 rounded-md px-2 text-sm text-foreground hover:bg-muted"
          onClick={() => openTab({ id: 'terminal-pinned', kind: 'terminal-pinned', key: 'terminal', title: t('workspaceSidebar.tool.terminal' as TranslationKey) })}
        >
          <CodexWebIcon name="terminal" size="sm" aria-hidden />
          <span>{t('workspaceSidebar.tool.terminal' as TranslationKey)}</span>
        </button>
        <button type="button" className="flex h-10 w-full items-center gap-3 rounded-md px-2 text-sm text-foreground hover:bg-muted" onClick={() => openTab({ id: 'files-pinned', kind: 'files-pinned', key: 'files', title: t('workspaceSidebar.tab.openFile' as TranslationKey) })}>
          <CodexWebIcon name="file_tree" size="sm" aria-hidden />
          <span>{t('workspaceSidebar.tool.files' as TranslationKey)}</span>
        </button>
        <button type="button" disabled className="flex h-10 w-full items-center gap-3 rounded-md px-2 text-sm text-muted-foreground disabled:opacity-70">
          <CodexWebIcon name="chat" size="sm" aria-hidden />
          <span>{t('workspaceSidebar.tool.sideChat' as TranslationKey)}</span>
        </button>
      </div>
    </div>
  );
}

function FileWorkspace() {
  const { previewSource, workingDirectory, setPreviewFile } = usePanel();
  const { t } = useTranslation();
  const filePath = previewSource?.kind === 'file' ? previewSource.filePath : null;
  const [treeFocus, setTreeFocus] = useState<{ path: string; seek: number } | null>(null);
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(filePath, workingDirectory),
    [filePath, workingDirectory],
  );
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-3 text-xs text-muted-foreground">
        {filePath ? breadcrumbs.map((item, index) => (
          <span key={item.path} className="inline-flex min-w-0 items-center">
            {index > 0 && <span className="px-1 text-muted-foreground/50">›</span>}
            <button
              type="button"
              className="truncate hover:text-foreground hover:underline"
              onClick={() => {
                if (item.isFile) setPreviewFile(item.path);
                else setTreeFocus({ path: item.path, seek: Date.now() });
              }}
              title={item.path}
            >
              {item.label}
            </button>
          </span>
        )) : <span>/</span>}
      </div>
      <div className="flex min-h-0 flex-1 divide-x divide-border">
        <div className="min-w-0 flex-1">
          {filePath ? <PreviewPanel variant="sidebar" /> : <EmptyFilePreview t={t} />}
        </div>
        <div className="w-[42%] min-w-[220px] max-w-[360px]">
          <FileTreePanel
            variant="sidebar"
            focusPath={treeFocus?.path}
            focusSeek={treeFocus?.seek}
          />
        </div>
      </div>
    </div>
  );
}

interface BreadcrumbItem {
  label: string;
  path: string;
  isFile: boolean;
}

function buildBreadcrumbs(filePath: string | null, workingDirectory: string): BreadcrumbItem[] {
  if (!filePath) return [];
  const separator = filePath.includes('\\') ? '\\' : '/';
  const root = workingDirectory.replace(/[\\/]+$/, '');
  const isWorkspaceFile = filePath === root || filePath.startsWith(`${root}${separator}`);
  if (!isWorkspaceFile) {
    return [{ label: filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath, path: filePath, isFile: true }];
  }
  const rootLabel = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  const relative = filePath.slice(root.length).split(/[\\/]/).filter(Boolean);
  const items: BreadcrumbItem[] = [{ label: rootLabel, path: root, isFile: relative.length === 0 }];
  let current = root;
  relative.forEach((segment, index) => {
    current = `${current}${separator}${segment}`;
    items.push({ label: segment, path: current, isFile: index === relative.length - 1 });
  });
  return items;
}

function EmptyFilePreview({ t }: { t: (key: TranslationKey) => string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <CodexWebIcon name="folder_open" size="lg" className="text-muted-foreground/70" aria-hidden />
      <div>
        <p className="text-base font-medium text-foreground">{t('workspaceSidebar.file.emptyTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('workspaceSidebar.file.emptyBody')}</p>
      </div>
    </div>
  );
}

/**
 * Shallow equality for the PreviewSource discriminator. Used by the
 * sync effect to suppress redundant context writes that would echo
 * through the workspace-tab-open-request event bridge.
 */
function samePreviewSource(
  a: NonNullable<ReturnType<typeof usePanel>['previewSource']>,
  b: NonNullable<ReturnType<typeof previewSourceFromTab>>,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file' && b.kind === 'file') return a.filePath === b.filePath;
  if (a.kind === 'inline-html' && b.kind === 'inline-html') return a.html === b.html && a.virtualName === b.virtualName;
  if (a.kind === 'inline-jsx' && b.kind === 'inline-jsx') return a.jsx === b.jsx && a.virtualName === b.virtualName;
  if (a.kind === 'inline-datatable' && b.kind === 'inline-datatable') return a.virtualName === b.virtualName;
  if (a.kind === 'inline-code' && b.kind === 'inline-code') return a.text === b.text && a.virtualName === b.virtualName;
  return false;
}
