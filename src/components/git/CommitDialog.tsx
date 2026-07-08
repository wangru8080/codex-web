"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface CommitDialogProps {
  cwd: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type CommitMode = "commit" | "commit-and-push";

export function CommitDialog({ cwd, open, onClose, onSuccess }: CommitDialogProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<CommitMode>("commit");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setError(null);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || !cwd || committing) return;
    setCommitting(true);
    setError(null);
    try {
      // Commit
      const commitRes = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, message: trimmed }),
      });
      if (!commitRes.ok) {
        const data = await commitRes.json();
        throw new Error(data.error || "Commit failed");
      }

      // Push if selected
      if (mode === "commit-and-push") {
        const pushRes = await fetch("/api/git/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd }),
        });
        if (!pushRes.ok) {
          const data = await pushRes.json();
          throw new Error(data.error || "Push failed");
        }
      }

      setMessage("");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setCommitting(false);
    }
  }, [cwd, message, mode, committing, onClose, onSuccess]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-[420px] rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold">{t('git.commitAll')}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('git.commitMessage')}
            className="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {/* Mode selector */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="commit-mode"
                checked={mode === "commit"}
                onChange={() => setMode("commit")}
                className="accent-primary"
              />
              <CodexWebIcon name="git_commit" size="sm" className="text-muted-foreground" aria-hidden />
              {t('topBar.commit')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="commit-mode"
                checked={mode === "commit-and-push"}
                onChange={() => setMode("commit-and-push")}
                className="accent-primary"
              />
              <CodexWebIcon name="upload_cloud" size="sm" className="text-muted-foreground" aria-hidden />
              {t('git.commitAndPush')}
            </label>
          </div>

          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!message.trim() || committing}
            onClick={handleSubmit}
          >
            {mode === "commit-and-push" ? (
              <CodexWebIcon name="upload_cloud" size="sm" className="mr-1.5" aria-hidden />
            ) : (
              <CodexWebIcon name="git_commit" size="sm" className="mr-1.5" aria-hidden />
            )}
            {committing
              ? t('git.loading')
              : mode === "commit-and-push"
                ? t('git.commitAndPush')
                : t('git.commitAll')
            }
          </Button>
        </div>
      </div>
    </div>
  );
}
