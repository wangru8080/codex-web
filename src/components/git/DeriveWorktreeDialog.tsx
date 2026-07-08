"use client";

import { useState, useMemo } from "react";
import { X } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { useRouter } from "next/navigation";

interface DeriveWorktreeDialogProps {
  cwd: string;
  repoName: string;
  sessionId?: string;
  onClose: () => void;
}

export function DeriveWorktreeDialog({ cwd, repoName, sessionId, onClose }: DeriveWorktreeDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [branch, setBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sanitizedBranch = useMemo(() => {
    return branch.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }, [branch]);

  const previewPath = sanitizedBranch
    ? `../${repoName}-worktrees/${sanitizedBranch}`
    : '';

  const handleCreate = async () => {
    if (!branch.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/git/worktrees/derive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, branch: branch.trim(), sourceSessionId: sessionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create worktree');
      }
      const data = await res.json();
      if (data.sessionId) {
        router.push(`/chat/${data.sessionId}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">{t('git.deriveWorktree')}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">{t('git.deriveBranch')}</label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="mt-1 h-8 text-xs"
              placeholder="feature/my-branch"
            />
          </div>

          {previewPath && (
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">{t('git.derivePreview')}</label>
              <p className="mt-1 text-[11px] font-mono text-muted-foreground bg-muted/50 rounded px-2 py-1">
                {previewPath}
              </p>
            </div>
          )}

          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}

          <Button
            className="w-full text-xs"
            disabled={!branch.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? t('git.loading') : t('git.deriveConfirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
