"use client";

import { useState, useEffect } from "react";
import { X, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitCommitDetail } from "@/types";

interface GitCommitDetailDialogProps {
  cwd: string;
  sha: string;
  onClose: () => void;
}

export function GitCommitDetailDialog({ cwd, sha, onClose }: GitCommitDetailDialogProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sha || !cwd) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/git/commit-detail/${sha}?cwd=${encodeURIComponent(cwd)}`);
        if (cancelled) return;
        if (!res.ok) throw new Error('Failed to load commit detail');
        const data = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sha, cwd]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[640px] max-h-[80vh] flex flex-col rounded-lg border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="text-sm font-semibold">{t('git.commitDetail')}</h3>
            <p className="text-[11px] text-muted-foreground font-mono">{sha.substring(0, 7)}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : detail ? (
            <div className="space-y-4">
              {/* Metadata */}
              <div className="space-y-1">
                <p className="text-sm font-medium">{detail.message}</p>
                <p className="text-[11px] text-muted-foreground">
                  {detail.authorName} &lt;{detail.authorEmail}&gt; · {detail.timestamp}
                </p>
              </div>

              {/* Stats */}
              {detail.stats && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {t('git.stats')}
                  </h4>
                  <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-mono">
                    {detail.stats}
                  </pre>
                </div>
              )}

              {/* Diff */}
              {detail.diff && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {t('git.diff')}
                  </h4>
                  <pre className="text-[11px] whitespace-pre-wrap font-mono overflow-x-auto bg-muted/30 rounded p-3 max-h-[400px] overflow-y-auto">
                    {detail.diff}
                  </pre>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
