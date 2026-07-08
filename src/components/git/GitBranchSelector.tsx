"use client";

import { useState, useEffect } from "react";
import { Check } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitBranch as GitBranchType } from "@/types";

interface GitBranchSelectorProps {
  cwd: string;
  currentBranch: string;
  dirty: boolean;
  onCheckout: (branch: string) => Promise<void>;
  error?: string | null;
}

export function GitBranchSelector({ cwd, currentBranch, dirty, onCheckout, error }: GitBranchSelectorProps) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !cwd) return;
    setLoading(true);
    fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`)
      .then(res => res.json())
      .then(data => setBranches(data.branches || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, cwd]);

  const [localError, setLocalError] = useState<string | null>(null);

  const handleCheckout = async (branch: string) => {
    if (dirty || branch === currentBranch) return;
    setCheckingOut(branch);
    setLocalError(null);
    try {
      await onCheckout(branch);
      setIsOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setCheckingOut(null);
    }
  };

  const localBranches = branches.filter(b => !b.isRemote);

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-xs"
        onClick={() => setIsOpen(!isOpen)}
      >
        <CodexWebIcon name="git" size="sm" className="mr-1.5" aria-hidden />
        {t('git.branchSelector')}
      </Button>

      {(error || localError) && (
        <p className="px-3 text-[11px] text-destructive">{error || localError}</p>
      )}

      {isOpen && (
        <div className="border rounded-md bg-background max-h-[200px] overflow-y-auto">
          {loading ? (
            <div className="p-2 text-[11px] text-muted-foreground">{t('git.loading')}</div>
          ) : (
            localBranches.map(branch => {
              const isCurrent = branch.name === currentBranch;
              const isOccupied = !!branch.worktreePath && !isCurrent;
              const disabled = dirty || isOccupied || isCurrent;

              return (
                <button
                  key={branch.name}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={disabled || checkingOut !== null}
                  onClick={() => handleCheckout(branch.name)}
                >
                  {isCurrent && <Check size={12} className="text-green-500 shrink-0" />}
                  {isOccupied && <CodexWebIcon name="permission" size={12} className="text-muted-foreground shrink-0" aria-hidden />}
                  {!isCurrent && !isOccupied && <span className="w-3 shrink-0" />}
                  <span className="truncate">{branch.name}</span>
                  {isOccupied && (
                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                      {t('git.worktreeOccupied')}
                    </span>
                  )}
                  {dirty && !isCurrent && !isOccupied && (
                    <span className="ml-auto text-[10px] text-amber-500 shrink-0">
                      {t('git.dirtyWorkTree')}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
