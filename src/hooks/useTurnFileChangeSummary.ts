'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppServerActions } from '@/codex-web/AppServerProvider';
import type { TurnFileChangeSummary } from '@/codex-web/file-change-summary';
import {
  filterTurnFileChangeSummaryByGitStatus,
  turnFileChangeGitPathspecs,
} from '@/codex-web/turn-file-change-git';

const GIT_REFRESH_INTERVAL_MS = 5_000;

type ResolvedSummary = {
  key: string;
  summary: TurnFileChangeSummary | null;
};

export function useTurnFileChangeSummary(
  summary: TurnFileChangeSummary | null,
  cwd: string,
): TurnFileChangeSummary | null {
  const { execCommand } = useAppServerActions();
  const [resolved, setResolved] = useState<ResolvedSummary | null>(null);
  const requestSequence = useRef(0);
  const key = summaryKey(summary, cwd);

  const refresh = useCallback(() => {
    const requestId = ++requestSequence.current;
    if (!summary || !cwd) {
      setResolved({ key, summary });
      return;
    }

    const commandOptions = {
      cwd,
      timeoutMs: 5_000,
      outputBytesCap: 256 * 1024,
      sandboxPolicy: { type: "readOnly" as const, networkAccess: false },
    };
    void Promise.all([
      execCommand({ command: ["git", "rev-parse", "--show-toplevel"], ...commandOptions }),
      execCommand({ command: ["git", "--literal-pathspecs", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...turnFileChangeGitPathspecs(summary)], ...commandOptions }),
    ]).then(([repository, status]) => {
      if (requestId !== requestSequence.current) return;
      const repoRoot = repository.stdout.trim();
      if (repository.exitCode !== 0 || status.exitCode !== 0 || !repoRoot) {
        setResolved({ key, summary });
        return;
      }
      setResolved({
        key,
        summary: filterTurnFileChangeSummaryByGitStatus(summary, {
          stdout: status.stdout,
          repoRoot,
          cwd,
        }),
      });
    }).catch(() => {
      if (requestId === requestSequence.current) setResolved({ key, summary });
    });
  }, [cwd, execCommand, key, summary]);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, GIT_REFRESH_INTERVAL_MS);
    window.addEventListener("git-refresh", refresh);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("git-refresh", refresh);
    };
  }, [refresh]);

  return resolved?.key === key ? resolved.summary : summary;
}

function summaryKey(summary: TurnFileChangeSummary | null, cwd: string): string {
  if (!summary) return `${cwd}:none`;
  return `${cwd}:${summary.files.map((file) => `${file.path}:${file.diff}`).join("\0")}`;
}
