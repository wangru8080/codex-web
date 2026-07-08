'use client';

/**
 * Phase 3 Step 4b — inline panel rendered in MessageList when the
 * latest run for the current chat session is `waiting_for_permission`.
 * Lets the user pick "Re-run this task" or "Abandon", which is the
 * v2 plan's hard line: NO durable resume. A paused run is dead;
 * re-run creates a new runId from scratch.
 *
 *   - **Re-run** → POST `/api/tasks/{taskId}/run` (existing endpoint
 *     from Step 3 / 4a). The old `waiting_for_permission` row stays
 *     in `task_run_logs` as history; a new row is created with
 *     `status: 'running'`, the agent re-evaluates from scratch.
 *
 *   - **Abandon** → PATCH `/api/tasks/runs/{runId}` (new endpoint
 *     from 4a). Flips the old row to `cancelled` and unpauses
 *     `scheduled_tasks.status` so the scheduler can re-fire on its
 *     normal cadence.
 *
 * The panel doesn't render any "continue from where it left off"
 * affordance — that would imply durable resume which v1 explicitly
 * doesn't do. A future Phase that ships durable agent state checkpoint
 * + replay can replace this panel with a richer UI; the abandon
 * endpoint and the re-run endpoint already match what that future
 * panel would need.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { TaskRunSummary } from '@/types';

export interface TaskWaitingForPermissionPanelProps {
  /** The waiting_for_permission run from the inline-joined taskRuns map. */
  run: TaskRunSummary;
  /** Optional callback fired after a successful action (re-run or abandon). */
  onAction?: () => void;
}

export function TaskWaitingForPermissionPanel({ run, onAction }: TaskWaitingForPermissionPanelProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState<'rerun' | 'abandon' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRerun = async () => {
    setPending('rerun');
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(run.task_id)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || `Re-run failed (${res.status})`);
        setPending(null);
        return;
      }
      onAction?.();
      // Navigate to the tasks page focused on this task so the user
      // sees the new running row immediately.
      router.push(`/settings/tasks?focus=${encodeURIComponent(run.task_id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-run failed');
      setPending(null);
    }
  };

  const handleAbandon = async () => {
    setPending('abandon');
    setError(null);
    try {
      const res = await fetch(`/api/tasks/runs/${encodeURIComponent(run.id)}`, {
        method: 'PATCH',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || `Abandon failed (${res.status})`);
        setPending(null);
        return;
      }
      onAction?.();
      // Stay on the chat page — the run row is now `cancelled` and
      // the panel won't re-render on next reconcile.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Abandon failed');
      setPending(null);
    }
  };

  return (
    <div
      className="my-3 rounded-lg border border-status-warning-foreground/30 bg-status-warning-muted px-4 py-3 text-sm"
      role="alert"
    >
      <p className="font-medium text-status-warning-foreground">
        {t('chat.taskWaiting.title' as TranslationKey)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('chat.taskWaiting.body' as TranslationKey)}
      </p>
      {error && (
        <p className="mt-2 text-xs text-status-error-foreground">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleRerun}
          disabled={pending !== null}
          className="rounded-md border border-border/60 bg-background px-3 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-60"
        >
          {pending === 'rerun'
            ? t('common.loading' as TranslationKey)
            : t('chat.taskWaiting.rerun' as TranslationKey)}
        </button>
        <button
          type="button"
          onClick={handleAbandon}
          disabled={pending !== null}
          className="rounded-md border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-60"
        >
          {pending === 'abandon'
            ? t('common.loading' as TranslationKey)
            : t('chat.taskWaiting.abandon' as TranslationKey)}
        </button>
      </div>
    </div>
  );
}
