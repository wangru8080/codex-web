"use client";

import { useState, useCallback } from "react";
import { ArrowUp, ArrowLeft, Circle } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { usePanel } from "@/hooks/usePanel";
import { showToast } from "@/hooks/useToast";
import { CommitDialog } from "./CommitDialog";
import type { GitStatus, GitChangedFile } from "@/types";

interface GitStatusSectionProps {
  status: GitStatus;
}

export function GitStatusSection({ status }: GitStatusSectionProps) {
  const { t } = useTranslation();
  const { workingDirectory } = usePanel();
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [pushing, setPushing] = useState(false);

  const handlePush = useCallback(async () => {
    if (!workingDirectory || pushing) return;
    setPushing(true);
    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Push failed' }));
        showToast({ type: 'error', message: data.error || 'Push failed' });
        return;
      }
      showToast({ type: 'success', message: t('git.pushSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Push failed' });
    } finally {
      setPushing(false);
    }
  }, [workingDirectory, pushing, t]);

  const handleCommitSuccess = useCallback(() => {
    window.dispatchEvent(new CustomEvent('git-refresh'));
  }, []);

  if (!status.isRepo) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
        {t('git.notARepo')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Branch + upstream */}
      <div className="flex items-center gap-2 px-3">
        <CodexWebIcon name="git" size="sm" className="text-muted-foreground shrink-0" aria-hidden />
        <span className="text-sm font-medium truncate">{status.branch || t('git.noBranch')}</span>
        {status.upstream && (
          <span className="text-[11px] text-muted-foreground truncate">
            → {status.upstream}
          </span>
        )}
      </div>

      {/* Ahead / behind */}
      {(status.ahead > 0 || status.behind > 0) && (
        <div className="flex items-center gap-3 px-3">
          {status.ahead > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
              <ArrowUp size={12} />
              {t('git.ahead', { count: String(status.ahead) })}
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-orange-600 dark:text-orange-400">
              <ArrowLeft size={12} />
              {t('git.behind', { count: String(status.behind) })}
            </span>
          )}
        </div>
      )}

      {/* Changed files — show tracked changes first, untracked separately */}
      {(() => {
        const tracked = status.changedFiles.filter(f => f.status !== 'untracked');
        const untracked = status.changedFiles.filter(f => f.status === 'untracked');

        if (tracked.length === 0 && untracked.length === 0) {
          return (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t('git.allCommitted')}
            </div>
          );
        }

        return (
          <div className="space-y-2">
            {tracked.length > 0 && (
              <div className="space-y-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('git.dirty', { count: String(tracked.length) })}
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {tracked.map((file, i) => (
                    <FileChangeItem key={`${file.path}-${file.staged}-${i}`} file={file} />
                  ))}
                </div>
              </div>
            )}
            {untracked.length > 0 && (
              <div className="space-y-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('git.untracked', { count: String(untracked.length) })}
                </div>
                <div className="max-h-[120px] overflow-y-auto">
                  {untracked.map((file, i) => (
                    <FileChangeItem key={`${file.path}-untracked-${i}`} file={file} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Commit & Push actions */}
      <div className="flex items-center gap-2 px-3 pt-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={() => setCommitDialogOpen(true)}
          disabled={!status.dirty}
        >
          <CodexWebIcon name="git_commit" size="sm" aria-hidden />
          {t('topBar.commit')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={handlePush}
          disabled={pushing}
        >
          <CodexWebIcon name="upload_cloud" size="sm" aria-hidden />
          {pushing ? t('git.loading') : t('topBar.push')}
        </Button>
      </div>

      <CommitDialog
        cwd={workingDirectory}
        open={commitDialogOpen}
        onClose={() => setCommitDialogOpen(false)}
        onSuccess={handleCommitSuccess}
      />
    </div>
  );
}

function FileChangeItem({ file }: { file: GitChangedFile }) {
  const statusColors: Record<string, string> = {
    modified: 'text-amber-500',
    added: 'text-green-500',
    deleted: 'text-red-500',
    renamed: 'text-blue-500',
    copied: 'text-blue-500',
    untracked: 'text-muted-foreground',
  };

  const statusLetters: Record<string, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: '?',
  };

  return (
    <div className="flex items-center gap-2 px-3 py-0.5 text-[12px] hover:bg-muted/50">
      <span className={`shrink-0 font-mono ${statusColors[file.status] || 'text-muted-foreground'}`}>
        {statusLetters[file.status] || '?'}
      </span>
      {file.staged && (
        <Circle size={6} weight="fill" className="text-green-500 shrink-0" />
      )}
      <span className="truncate text-foreground/80">{file.path}</span>
    </div>
  );
}
