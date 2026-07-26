"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CaretRight, Eye, SpinnerGap } from "@/components/ui/icon";
import { showToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import type { GitHistoryEntry, GitHistoryFile } from "@/types";

const PAGE_SIZE = 30;

type Props = {
  branch: string;
  readHistory: (offset?: number, limit?: number) => Promise<{
    entries: GitHistoryEntry[];
    hasMore: boolean;
  }>;
  readFiles: (sha: string) => Promise<GitHistoryFile[]>;
  onPreviewDiff: (entry: GitHistoryEntry, file: GitHistoryFile) => Promise<void>;
  onPreviewFile: (entry: GitHistoryEntry, file: GitHistoryFile) => Promise<void>;
};

export function GitHistorySection({
  branch,
  readHistory,
  readFiles,
  onPreviewDiff,
  onPreviewFile,
}: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<GitHistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [filesBySha, setFilesBySha] = useState<Record<string, GitHistoryFile[]>>({});
  const [loadingFilesSha, setLoadingFilesSha] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await readHistory(0, PAGE_SIZE);
      setEntries(page.entries);
      setHasMore(page.hasMore);
      setFilesBySha({});
      setExpandedSha(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [readHistory]);

  useEffect(() => {
    void refresh();
    const handleRefresh = () => void refresh();
    window.addEventListener("git-refresh", handleRefresh);
    return () => window.removeEventListener("git-refresh", handleRefresh);
  }, [refresh]);

  const toggleCommit = async (entry: GitHistoryEntry) => {
    if (expandedSha === entry.sha) {
      setExpandedSha(null);
      return;
    }
    setExpandedSha(entry.sha);
    if (filesBySha[entry.sha]) return;
    setLoadingFilesSha(entry.sha);
    try {
      const files = await readFiles(entry.sha);
      setFilesBySha((current) => ({ ...current, [entry.sha]: files }));
    } catch (reason) {
      showToast({ type: "error", message: errorMessage(reason) });
      setExpandedSha(null);
    } finally {
      setLoadingFilesSha(null);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await readHistory(entries.length, PAGE_SIZE);
      setEntries((current) => [...current, ...page.entries]);
      setHasMore(page.hasMore);
    } catch (reason) {
      showToast({ type: "error", message: errorMessage(reason) });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="git-history">
      <div className="shrink-0 border-b border-border/40 px-3 py-2.5">
        <p className="truncate text-sm font-medium">{branch || t("git.noBranch")}</p>
        <p className="text-xs text-muted-foreground">{t("git.historyReadOnly")}</p>
      </div>

      {loading ? (
        <HistoryState><SpinnerGap size={18} className="animate-spin" /></HistoryState>
      ) : error ? (
        <HistoryState>
          <span className="text-destructive">{error}</span>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>{t("git.refresh")}</Button>
        </HistoryState>
      ) : entries.length === 0 ? (
        <HistoryState>{t("git.noHistory")}</HistoryState>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {entries.map((entry) => {
            const expanded = expandedSha === entry.sha;
            const files = filesBySha[entry.sha];
            return (
              <div key={entry.sha} className="border-b border-border/30 last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-muted/50"
                  aria-expanded={expanded}
                  data-testid={`git-history-commit-${entry.sha.slice(0, 7)}`}
                  onClick={() => void toggleCommit(entry)}
                >
                  <CaretRight size={14} className={cn("mt-0.5 shrink-0 transition-transform", expanded && "rotate-90")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{entry.message}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      <span className="font-mono">{entry.sha.slice(0, 7)}</span>
                      {" · "}{entry.authorName}{" · "}{formatTimestamp(entry.timestamp)}
                    </span>
                  </span>
                </button>

                {expanded && (
                  <div className="pb-1 pl-6 pr-1" data-testid="git-history-files">
                    {loadingFilesSha === entry.sha ? (
                      <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                        <SpinnerGap size={14} className="animate-spin" />{t("git.loading")}
                      </div>
                    ) : files?.length ? files.map((file) => (
                      <HistoryFileRow
                        key={`${file.status}:${file.originalPath ?? ""}:${file.path}`}
                        file={file}
                        onPreviewDiff={() => void onPreviewDiff(entry, file).catch((reason) => showToast({
                          type: "error",
                          message: errorMessage(reason),
                        }))}
                        onPreviewFile={() => void onPreviewFile(entry, file).catch((reason) => showToast({
                          type: "error",
                          message: errorMessage(reason),
                        }))}
                      />
                    )) : (
                      <div className="px-2 py-2 text-xs text-muted-foreground">{t("git.noCommitFiles")}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <div className="p-2">
              <Button className="w-full" size="sm" variant="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? t("git.loading") : t("git.loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryFileRow({
  file,
  onPreviewDiff,
  onPreviewFile,
}: {
  file: GitHistoryFile;
  onPreviewDiff: () => void;
  onPreviewFile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-9 items-center gap-2 rounded px-2 hover:bg-muted/50">
      <span className="w-3 shrink-0 font-mono text-xs text-muted-foreground">{historyStatusLetter(file)}</span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left font-mono text-xs"
        title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
        data-testid="git-history-file"
        onClick={onPreviewDiff}
      >
        {file.path}
        {file.originalPath && <span className="block truncate text-[10px] text-muted-foreground">← {file.originalPath}</span>}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="h-7 w-7 shrink-0"
        title={t("git.viewHistoricalFile")}
        aria-label={t("git.viewHistoricalFileNamed", { path: file.path })}
        onClick={onPreviewFile}
      >
        <Eye size={14} />
      </Button>
    </div>
  );
}

function HistoryState({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">{children}</div>;
}

function historyStatusLetter(file: GitHistoryFile): string {
  if (file.status === "renamed") return "R";
  if (file.status === "copied") return "C";
  return file.status[0].toUpperCase();
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Git 操作失败";
}
