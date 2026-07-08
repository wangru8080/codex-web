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

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import { usePanel } from '@/hooks/usePanel';
import { previewSourceFromTab, type Tab } from '@/lib/workspace-sidebar';

const GitTabContent = dynamic(
  () => import('@/components/layout/panels/GitPanel').then((m) => ({ default: m.GitTabContent })),
  { ssr: false },
);
const WidgetTabContent = dynamic(
  () => import('@/components/layout/panels/DashboardPanel').then((m) => ({ default: m.WidgetTabContent })),
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

function ActiveContent({ tab }: { tab: Tab }) {
  if (tab.kind === 'fixed') {
    return tab.id === 'git' ? <GitTabContent /> : <WidgetTabContent />;
  }
  if (tab.kind === 'files-pinned') {
    // sidebar variant strips the legacy panel chrome (Pin / Close /
    // ResizeHandle / panel title) — the Tab strip's X owns close, the
    // shell owns resize, and Pin is meaningless because we're already
    // inside the sidebar. (Codex P2 收口 2026-04-30.)
    return <FileTreePanel variant="sidebar" />;
  }
  // markdown / artifact / file all flow through PreviewPanel; the
  // panel reads previewSource from PanelContext (kept in sync by
  // openWorkspaceTab callers in MessageItem / FileTreePanel /
  // DiffSummary — see Track 4). sidebar variant strips the redundant
  // outer ResizeHandle / width / Close chrome.
  return <PreviewPanel variant="sidebar" />;
}

export function TabPanel() {
  const { state } = useWorkspaceSidebar();
  const { previewSource, setPreviewSource } = usePanel();
  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];

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

  if (!active) return null;
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
      <ActiveContent tab={active} />
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
  return false;
}
