"use client";

import { useState, useEffect } from "react";
import { DotOutline, ArrowRight } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { useRouter } from "next/navigation";
import type { GitWorktree } from "@/types";

interface GitWorktreeSectionProps {
  cwd: string;
  onDeriveWorktree: () => void;
}

export function GitWorktreeSection({ cwd, onDeriveWorktree }: GitWorktreeSectionProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/git/worktrees?cwd=${encodeURIComponent(cwd)}`);
        const data = await res.json();
        if (!cancelled) setWorktrees(data.worktrees || []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [cwd]);

  const handleSwitchTo = async (worktreePath: string) => {
    // Find or create a session for this worktree's working directory
    try {
      const res = await fetch(`/api/chat/sessions/by-cwd?cwd=${encodeURIComponent(worktreePath)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) {
          router.push(`/chat/${data.sessionId}`);
          return;
        }
      }
      // No existing session — create one
      const createRes = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_directory: worktreePath }),
      });
      if (createRes.ok) {
        const data = await createRes.json();
        router.push(`/chat/${data.session.id}`);
      }
    } catch {
      // fallback: just navigate to chat
    }
  };

  if (loading) {
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('git.loading')}</div>;
  }

  const isCurrent = (wt: GitWorktree) => {
    // Normalize paths for comparison
    const normalize = (p: string) => p.replace(/\/+$/, '');
    return normalize(wt.path) === normalize(cwd);
  };

  return (
    <div className="space-y-1">
      {worktrees.map(wt => {
        const current = isCurrent(wt);
        return (
          <div
            key={wt.path}
            className={`flex items-center gap-2 px-3 py-1.5 ${current ? 'bg-muted/30' : 'hover:bg-muted/20'}`}
          >
            <CodexWebIcon name="folder" size="sm" className={current ? 'text-foreground shrink-0' : 'text-muted-foreground shrink-0'} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className={`text-[12px] truncate ${current ? 'font-medium' : ''}`}>
                  {wt.branch || wt.head.substring(0, 7)}
                </span>
                {current && (
                  <span className="text-[9px] text-muted-foreground bg-muted rounded px-1">{t('git.current')}</span>
                )}
                {wt.dirty && (
                  <DotOutline size={10} weight="fill" className="text-amber-500 shrink-0" />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{wt.path}</p>
            </div>
            {!current && !wt.bare && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => handleSwitchTo(wt.path)}
              >
                <ArrowRight size={12} />
                <span className="sr-only">{t('git.switchWorktree')}</span>
              </Button>
            )}
          </div>
        );
      })}

      <div className="px-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={onDeriveWorktree}
        >
          <CodexWebIcon name="plus" size="sm" className="mr-1.5" aria-hidden />
          {t('git.deriveWorktree')}
        </Button>
      </div>
    </div>
  );
}
