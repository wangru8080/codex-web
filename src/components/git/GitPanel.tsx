"use client";

import { useEffect, useState } from "react";
import { usePanel } from "@/hooks/usePanel";
import { useGitWorkspace } from "@/hooks/useGitWorkspace";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { GitStatusSection } from "./GitStatusSection";

export function GitPanel() {
  const { workingDirectory, setPreviewSource } = usePanel();
  const { t } = useTranslation();
  const git = useGitWorkspace(workingDirectory);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    const available = new Set(git.status?.changedFiles.map((file) => file.path) ?? []);
    setSelectedPaths((current) => new Set([...current].filter((path) => available.has(path))));
  }, [git.status]);

  if (git.loading && !git.status) {
    return <GitPanelState>{t('git.loading')}</GitPanelState>;
  }

  if (git.error && !git.status) {
    return (
      <GitPanelState>
        <span>{git.error}</span>
        <Button size="sm" variant="outline" onClick={() => void git.refresh()}>{t('git.refresh')}</Button>
      </GitPanelState>
    );
  }

  if (!git.status?.isRepo) {
    return <GitPanelState>{t('git.notARepo')}</GitPanelState>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="git-panel" data-source-breadcrumb="app-server.command/exec">
      {git.error && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {git.error}
        </div>
      )}
      <GitStatusSection
        status={git.status}
        selectedPaths={selectedPaths}
        committing={git.committing}
        onTogglePath={(path) => setSelectedPaths((current) => {
          const next = new Set(current);
          if (next.has(path)) next.delete(path); else next.add(path);
          return next;
        })}
        onToggleAll={() => setSelectedPaths((current) => current.size === git.status!.changedFiles.length
          ? new Set()
          : new Set(git.status!.changedFiles.map((file) => file.path)))}
        onPreview={async (file) => {
          const diff = await git.readDiff(file);
          setPreviewSource({
            kind: 'inline-diff',
            diff,
            virtualName: file.path.split(/[/\\]/).pop() || file.path,
          });
        }}
        onCommit={async (message) => {
          const files = git.status!.changedFiles.filter((file) => selectedPaths.has(file.path));
          await git.commitSelected(files, message);
          setSelectedPaths(new Set());
        }}
      />
    </div>
  );
}

function GitPanelState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
