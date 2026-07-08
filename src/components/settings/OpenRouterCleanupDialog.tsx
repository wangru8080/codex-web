"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { showToast } from "@/hooks/useToast";

/**
 * "整理 OpenRouter 早期导入的目录" — opt-in cleanup for users carrying
 * the 300+ rows from old auto-materialization. Two-step:
 *   1. Open dialog → preview fetch lists candidate rows
 *   2. Confirm → bulk hide (rows stay in DB, enabled=0, marked manual_hidden)
 *
 * The server's WHERE clause guarantees `manual_enabled` / `manual_hidden`
 * / `user_edited=1` rows are excluded. Description copy spells that out
 * so users know nothing they deliberately enabled gets touched.
 */

interface CandidateRow {
  model_id: string;
  display_name: string;
  source: string;
  enable_source: string;
}

interface PreviewResponse {
  mode: 'preview';
  candidates: CandidateRow[];
  count: number;
}

interface CommitResponse {
  mode: 'commit';
  hiddenCount: number;
}

interface OpenRouterCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  /** Refetch the parent's bundle after a successful hide so rows render
   *  with the new enabled=0 state. */
  onCleaned?: () => void;
}

export function OpenRouterCleanupDialog({
  open,
  onOpenChange,
  providerId,
  onCleaned,
}: OpenRouterCleanupDialogProps) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCandidates([]);
      setFetchError(null);
      setCommitting(false);
      return;
    }
    let aborted = false;
    setLoading(true);
    setFetchError(null);
    fetch(`/api/providers/${providerId}/openrouter-legacy-cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'preview' }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<PreviewResponse>;
      })
      .then(data => {
        if (aborted) return;
        setCandidates(data.candidates);
      })
      .catch(err => {
        if (aborted) return;
        setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [open, providerId]);

  const handleConfirm = async () => {
    if (committing) return;
    setCommitting(true);
    try {
      const res = await fetch(`/api/providers/${providerId}/openrouter-legacy-cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as CommitResponse;
      showToast({
        type: 'success',
        message: t('provider.cleanup.openrouter.success' as TranslationKey, {
          count: String(data.hiddenCount),
        }),
        duration: 5000,
      });
      onCleaned?.();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('provider-changed'));
      }
      onOpenChange(false);
    } catch (err) {
      showToast({
        type: 'error',
        message: t('provider.cleanup.openrouter.error' as TranslationKey, {
          error: err instanceof Error ? err.message : String(err),
        }),
        duration: 6000,
      });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
          <DialogTitle>{t('provider.cleanup.openrouter.dialogTitle' as TranslationKey)}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t('provider.cleanup.openrouter.description' as TranslationKey)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <SpinnerGap size={16} className="animate-spin" />
              <span className="text-xs">…</span>
            </div>
          )}
          {fetchError && !loading && (
            <div className="rounded-md border border-status-error-border bg-status-error-muted p-3 text-xs text-status-error-foreground">
              {t('provider.cleanup.openrouter.fetchError' as TranslationKey, { error: fetchError })}
            </div>
          )}
          {!loading && !fetchError && candidates.length === 0 && (
            <div className="py-12 text-center text-xs text-muted-foreground">
              {t('provider.cleanup.openrouter.empty' as TranslationKey)}
            </div>
          )}
          {!loading && !fetchError && candidates.length > 0 && (
            <>
              <div className="mb-3 text-xs text-muted-foreground">
                {t('provider.cleanup.openrouter.previewCount' as TranslationKey, {
                  count: String(candidates.length),
                })}
              </div>
              <div className="rounded-md bg-muted/40">
                <div className="divide-y divide-border/50">
                  {candidates.map(row => (
                    <div key={row.model_id} className="px-3.5 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs truncate">{row.display_name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{row.model_id}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 border-t gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={committing}>
            {t('provider.cleanup.openrouter.cancel' as TranslationKey)}
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={loading || committing || candidates.length === 0 || !!fetchError}
            className="gap-1.5"
          >
            {committing && <SpinnerGap size={12} className="animate-spin" />}
            {committing
              ? t('provider.cleanup.openrouter.confirming' as TranslationKey)
              : t('provider.cleanup.openrouter.confirm' as TranslationKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
