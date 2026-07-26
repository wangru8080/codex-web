"use client";

import { useState } from "react";

import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { showToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitChangedFile, GitStatus } from "@/types";
import { CommitDialog } from "./CommitDialog";

type Props = {
  status: GitStatus;
  selectedPaths: Set<string>;
  committing: boolean;
  onTogglePath: (path: string) => void;
  onToggleAll: () => void;
  onPreview: (file: GitChangedFile) => Promise<void>;
  onCommit: (message: string) => Promise<void>;
};

export function GitStatusSection({
  status,
  selectedPaths,
  committing,
  onTogglePath,
  onToggleAll,
  onPreview,
  onCommit,
}: Props) {
  const { t } = useTranslation();
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const selectedFiles = status.changedFiles.filter((file) => selectedPaths.has(file.path));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2.5">
        <CodexWebIcon name="git" size="sm" className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{status.branch || t('git.noBranch')}</span>
        {status.dirty && (
          <span className="shrink-0 text-xs text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">+{status.additions ?? 0}</span>
            {' '}
            <span className="text-rose-600 dark:text-rose-400">-{status.deletions ?? 0}</span>
          </span>
        )}
      </div>

      {!status.dirty ? (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          {t('git.allCommitted')}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between px-3 py-2 text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selectedPaths.size === status.changedFiles.length}
                onChange={onToggleAll}
                aria-label={t('git.selectAll')}
              />
              {t('git.dirty', { count: String(status.changedFiles.length) })}
            </label>
            <span>{t('git.selected', { count: String(selectedPaths.size) })}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {status.changedFiles.map((file) => (
              <FileChangeItem
                key={`${file.path}:${file.originalPath ?? ''}`}
                file={file}
                selected={selectedPaths.has(file.path)}
                onToggle={() => onTogglePath(file.path)}
                onPreview={() => void onPreview(file).catch((reason) => showToast({
                  type: 'error',
                  message: reason instanceof Error ? reason.message : t('git.error'),
                }))}
              />
            ))}
          </div>
          <div className="shrink-0 border-t border-border/40 p-2.5">
            <Button
              className="w-full"
              size="sm"
              disabled={selectedFiles.length === 0 || committing}
              onClick={() => setCommitDialogOpen(true)}
            >
              <CodexWebIcon name="git_commit" size="sm" className="mr-1.5" aria-hidden />
              {t('git.commitSelected', { count: String(selectedFiles.length) })}
            </Button>
          </div>
        </>
      )}

      <CommitDialog
        files={selectedFiles}
        open={commitDialogOpen}
        committing={committing}
        onClose={() => setCommitDialogOpen(false)}
        onCommit={async (message) => {
          await onCommit(message);
          showToast({ type: 'success', message: t('git.commitSuccess') });
          setCommitDialogOpen(false);
        }}
      />
    </div>
  );
}

function FileChangeItem({
  file,
  selected,
  onToggle,
  onPreview,
}: {
  file: GitChangedFile;
  selected: boolean;
  onToggle: () => void;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const statusLetter = file.status === 'untracked' ? '?' : file.status[0].toUpperCase();
  return (
    <div className="flex min-h-9 items-center gap-2 rounded px-2 hover:bg-muted/50">
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={file.path} />
      <span className="w-3 shrink-0 font-mono text-xs text-muted-foreground">{statusLetter}</span>
      <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-xs" title={file.path} onClick={onPreview}>
        {file.path}
      </button>
      {file.staged && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title={t('git.staged')} />}
      {file.additions != null && <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">+{file.additions}</span>}
      {file.deletions != null && <span className="shrink-0 text-xs text-rose-600 dark:text-rose-400">-{file.deletions}</span>}
    </div>
  );
}
