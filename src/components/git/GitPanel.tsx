"use client";

import { useEffect, useState } from "react";
import { usePanel } from "@/hooks/usePanel";
import { useGitWorkspace } from "@/hooks/useGitWorkspace";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GitHistoryFile } from "@/types";
import { GitHistorySection } from "./GitHistorySection";
import { GitStatusSection } from "./GitStatusSection";

type GitPanelView = "changes" | "history";
let lastGitPanelView: GitPanelView = "changes";

export function GitPanel() {
  const { workingDirectory, setPreviewSource } = usePanel();
  const { t } = useTranslation();
  const git = useGitWorkspace(workingDirectory);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [view, setView] = useState<GitPanelView>(lastGitPanelView);
  const selectView = (next: GitPanelView) => {
    lastGitPanelView = next;
    setView(next);
  };

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
      <div className="shrink-0 px-3 pb-2">
        <Tabs value={view} onValueChange={(value) => selectView(value as GitPanelView)}>
          <TabsList size="sm" className="w-full" aria-label={t("git.viewSwitcher")}>
            <TabsTrigger value="changes" data-testid="git-view-changes" onClick={() => selectView("changes")}>{t("git.changes")}</TabsTrigger>
            <TabsTrigger value="history" data-testid="git-view-history" onClick={() => selectView("history")}>{t("git.history")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {view === "changes" ? (
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
      ) : (
        <GitHistorySection
          branch={git.status.branch}
          readHistory={git.readHistory}
          readFiles={git.readHistoryFiles}
          onPreviewDiff={async (entry, file) => {
            const diff = await git.readHistoricalDiff(entry.sha, file);
            setPreviewSource({
              kind: "inline-diff",
              diff,
              virtualName: `${fileName(file)} · ${t("git.diff")} @ ${entry.sha.slice(0, 7)}`,
            });
          }}
          onPreviewFile={async (entry, file) => {
            const text = await git.readHistoricalFile(entry.sha, file);
            setPreviewSource({
              kind: "inline-code",
              text,
              language: historyFileLanguage(file),
              virtualName: `${fileName(file)} @ ${entry.sha.slice(0, 7)}`,
            });
          }}
        />
      )}
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

function fileName(file: GitHistoryFile): string {
  return file.path.split(/[/\\]/).pop() || file.path;
}

function historyFileLanguage(file: GitHistoryFile): string {
  const extension = file.path.split(".").pop()?.toLowerCase() ?? "";
  return ({
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    sh: "bash",
    yaml: "yaml",
    yml: "yaml",
  } as Record<string, string>)[extension] ?? "plaintext";
}
