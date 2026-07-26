'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppServerActions } from '@/codex-web/AppServerProvider';
import {
  applyGitNumstat,
  buildGitCommitCommands,
  gitCommitPathspecs,
  parseGitNumstat,
  parseGitWorkspaceStatus,
} from '@/codex-web/git-workspace';
import type { GitChangedFile, GitStatus } from '@/types';

const REFRESH_INTERVAL_MS = 10_000;
const OUTPUT_CAP = 1024 * 1024;

const emptyStatus = (repoRoot = ''): GitStatus => ({
  isRepo: false,
  repoRoot,
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  dirty: false,
  additions: 0,
  deletions: 0,
  changedFiles: [],
});

export function useGitWorkspace(cwd: string, includeUntrackedStats = true) {
  const { execCommand } = useAppServerActions();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const readOnlyOptions = {
    cwd,
    timeoutMs: 5_000,
    outputBytesCap: OUTPUT_CAP,
    sandboxPolicy: { type: 'readOnly' as const, networkAccess: false },
  };

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!cwd) {
      setStatus(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const repository = await execCommand({
        command: ['git', 'rev-parse', '--show-toplevel'],
        ...readOnlyOptions,
      });
      if (requestId !== requestSequence.current) return;
      if (repository.exitCode !== 0 || !repository.stdout.trim()) {
        setStatus(emptyStatus());
        setError(null);
        return;
      }
      const repoRoot = repository.stdout.trim();
      const [porcelain, numstat] = await Promise.all([
        execCommand({
          command: ['git', 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'],
          ...readOnlyOptions,
        }),
        execCommand({
          command: ['git', 'diff', '--numstat', '-z', '--no-renames', 'HEAD', '--'],
          ...readOnlyOptions,
        }),
      ]);
      if (requestId !== requestSequence.current) return;
      if (porcelain.exitCode !== 0) throw commandError(porcelain, '读取 Git 状态失败');
      const parsed = parseGitWorkspaceStatus(porcelain.stdout, repoRoot);
      const stats = numstat.exitCode === 0 ? parseGitNumstat(numstat.stdout) : new Map();
      // ponytail: cap per-file no-index probes; raise only if real repositories need more exact totals.
      const untracked = includeUntrackedStats
        ? parsed.changedFiles.filter((file) => file.status === 'untracked').slice(0, 20)
        : [];
      const untrackedStats = await Promise.allSettled(untracked.map((file) => execCommand({
        command: ['git', '--literal-pathspecs', 'diff', '--no-index', '--numstat', '-z', '--', '/dev/null', file.path],
        ...readOnlyOptions,
      })));
      if (requestId !== requestSequence.current) return;
      for (const result of untrackedStats) {
        if (result.status !== 'fulfilled') continue;
        const response = result.value;
        if (response.exitCode === 0 || response.exitCode === 1) {
          for (const [path, stat] of parseGitNumstat(response.stdout)) stats.set(path, stat);
        }
      }
      setStatus(applyGitNumstat(parsed, stats));
      setError(null);
    } catch (reason) {
      if (requestId === requestSequence.current) {
        setError(errorMessage(reason));
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [cwd, execCommand, includeUntrackedStats]);

  const readDiff = useCallback(async (file: GitChangedFile): Promise<string> => {
    const added = file.status === 'untracked' || file.status === 'added';
    const response = await execCommand({
      command: added
        ? ['git', '--literal-pathspecs', 'diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', file.path]
        : ['git', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-color', 'HEAD', '--', ...gitCommitPathspecs([file])],
      ...readOnlyOptions,
    });
    if (response.exitCode !== 0 && !(added && response.exitCode === 1)) {
      throw commandError(response, '读取文件差异失败');
    }
    if (!response.stdout) throw new Error('该文件没有可预览的差异');
    return response.stdout;
  }, [cwd, execCommand]);

  const commitSelected = useCallback(async (files: GitChangedFile[], message: string) => {
    const trimmed = message.trim();
    const paths = gitCommitPathspecs(files);
    if (!cwd || paths.length === 0 || !trimmed) throw new Error('请选择文件并填写提交信息');
    setCommitting(true);
    try {
      const metadata = await Promise.all([
        execCommand({ command: ['git', 'rev-parse', '--show-toplevel'], ...readOnlyOptions }),
        execCommand({ command: ['git', 'rev-parse', '--absolute-git-dir'], ...readOnlyOptions }),
        execCommand({ command: ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], ...readOnlyOptions }),
      ]);
      if (metadata.some((response) => response.exitCode !== 0 || !response.stdout.trim())) {
        throw new Error('无法解析 Git 仓库写入目录');
      }
      const writableRoots = [...new Set(metadata.map((response) => response.stdout.trim()))];
      const writeOptions = {
        cwd,
        timeoutMs: 30_000,
        outputBytesCap: OUTPUT_CAP,
        env: { GIT_TERMINAL_PROMPT: '0' },
        sandboxPolicy: {
          type: 'workspaceWrite' as const,
          writableRoots,
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      };
      const commands = buildGitCommitCommands(files, trimmed);
      const staged = await execCommand({
        command: commands.stage,
        ...writeOptions,
      });
      if (staged.exitCode !== 0) throw commandError(staged, '暂存所选文件失败');
      const committed = await execCommand({
        command: commands.commit,
        ...writeOptions,
      });
      if (committed.exitCode !== 0) throw commandError(committed, 'Git 提交失败');
      window.dispatchEvent(new CustomEvent('git-refresh'));
      return committed;
    } finally {
      setCommitting(false);
    }
  }, [cwd, execCommand]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const handleRefresh = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('git-refresh', handleRefresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('git-refresh', handleRefresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  return { status, loading, committing, error, refresh, readDiff, commitSelected };
}

function commandError(
  response: { stdout: string; stderr: string },
  fallback: string,
): Error {
  return new Error(response.stderr.trim() || response.stdout.trim() || fallback);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Git 操作失败';
}
