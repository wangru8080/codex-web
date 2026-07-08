"use client";

import { useState, useCallback } from "react";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";

interface GitCommitSectionProps {
  cwd: string;
  dirty: boolean;
  onCommitSuccess: () => void;
}

export function GitCommitSection({ cwd, dirty, onCommitSuccess }: GitCommitSectionProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = useCallback(async () => {
    if (!cwd || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, message: message.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Commit failed');
      }
      setMessage("");
      onCommitSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }, [cwd, message, committing, onCommitSuccess]);

  return (
    <div className="space-y-2 px-3">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('git.commitMessage')}
        className="h-8 text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleCommit();
          }
        }}
      />
      <Button
        variant="default"
        size="sm"
        className="w-full text-xs"
        disabled={!dirty || committing}
        onClick={handleCommit}
      >
        <CodexWebIcon name="git_commit" size="sm" className="mr-1.5" aria-hidden />
        {committing ? t('git.loading') : t('git.commitAll')}
      </Button>
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
