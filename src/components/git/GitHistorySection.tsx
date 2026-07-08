"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitLogEntry } from "@/types";

interface GitHistorySectionProps {
  cwd: string;
  onSelectCommit: (sha: string) => void;
}

export function GitHistorySection({ cwd, onSelectCommit }: GitHistorySectionProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/git/log?cwd=${encodeURIComponent(cwd)}&limit=30`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  // Refresh on git-refresh events (commit, checkout, etc.)
  useEffect(() => {
    const handler = () => void fetchHistory();
    window.addEventListener('git-refresh', handler);
    return () => window.removeEventListener('git-refresh', handler);
  }, [fetchHistory]);

  if (loading) {
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('git.loading')}</div>;
  }

  if (entries.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('git.noChanges')}</div>;
  }

  return (
    <div className="max-h-[300px] overflow-y-auto">
      {entries.map(entry => (
        <button
          key={entry.sha}
          className="flex items-start gap-2 w-full px-3 py-1.5 text-left hover:bg-muted/50"
          onClick={() => onSelectCommit(entry.sha)}
        >
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground mt-0.5">
            {entry.sha.substring(0, 7)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] truncate text-foreground/80">{entry.message}</p>
            <p className="text-[10px] text-muted-foreground">
              {entry.authorName} · {formatRelativeTime(entry.timestamp)}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
