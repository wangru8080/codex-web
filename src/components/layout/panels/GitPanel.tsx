"use client";

import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { GitPanel } from "@/components/git/GitPanel";

/**
 * GitTabContent — the Git surface stripped of its outer chrome
 * (resize handle, panel title bar, close button). This is what the
 * Workspace Sidebar's `git` fixed Tab renders.
 *
 * The Tab Bar above it owns both the Tab title (rendered as a Tab
 * pill) and the close affordance (which is disabled for fixed Tabs).
 * A single `git.refresh` button stays at the top of the content area
 * because users expect "refresh git" inside the Git surface itself,
 * not on a chrome edge.
 */
export function GitTabContent() {
  const { t } = useTranslation();
  const handleRefresh = () => {
    window.dispatchEvent(new CustomEvent('git-refresh'));
  };
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center justify-end px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleRefresh}
          title={t('git.refresh')}
          aria-label={t('git.refresh')}
        >
          <CodexWebIcon name="refresh" size="sm" aria-hidden />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <GitPanel />
      </div>
    </div>
  );
}

// Phase 2 (2026-04-30): legacy `GitPanelContainer` removed. The Git
// surface is now exclusively rendered by the Workspace Sidebar's `git`
// fixed Tab via `<GitTabContent />`. PanelZone no longer reads
// `gitPanelOpen` and the topbar Git toggle was deleted in Phase 1.
