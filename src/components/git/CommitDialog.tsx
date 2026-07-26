"use client";

import { useEffect, useRef, useState } from "react";

import { X } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitChangedFile } from "@/types";

type Props = {
  files: GitChangedFile[];
  open: boolean;
  committing: boolean;
  onClose: () => void;
  onCommit: (message: string) => Promise<void>;
};

export function CommitDialog({ files, open, committing, onClose, onCommit }: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
    else {
      setMessage("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !committing) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [committing, onClose, open]);

  const submit = async () => {
    if (!message.trim() || files.length === 0 || committing) return;
    setError(null);
    try {
      await onCommit(message.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('git.error'));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="git-commit-dialog">
      <button className="absolute inset-0 bg-black/50" aria-label={t('common.cancel')} onClick={() => !committing && onClose()} />
      <div className="relative z-10 w-full max-w-[420px] rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <h3 className="text-sm font-semibold">{t('git.commitSelected', { count: String(files.length) })}</h3>
          <Button variant="ghost" size="icon-sm" disabled={committing} onClick={onClose} aria-label={t('common.close')}>
            <X size={14} />
          </Button>
        </div>
        <div className="space-y-3 p-4">
          <div className="max-h-28 overflow-y-auto rounded border border-border/50 px-2 py-1.5">
            {files.map((file) => <div key={file.path} className="truncate font-mono text-xs text-muted-foreground">{file.path}</div>)}
          </div>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t('git.commitMessage')}
            className="h-24 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/40 px-4 py-3">
          <Button variant="ghost" size="sm" disabled={committing} onClick={onClose}>{t('common.cancel')}</Button>
          <Button data-testid="git-commit-submit" size="sm" disabled={!message.trim() || files.length === 0 || committing} onClick={() => void submit()}>
            <CodexWebIcon name="git_commit" size="sm" className="mr-1.5" aria-hidden />
            {committing ? t('git.loading') : t('git.commit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
