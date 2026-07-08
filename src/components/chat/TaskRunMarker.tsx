'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import type { TaskRunSummary } from '@/types';
import type { TranslationKey } from '@/i18n';
import { CheckCircle, X as XIcon } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';

/**
 * Phase 3 Step 4 — inline marker that appears in MessageList before
 * the FIRST message belonging to a given `task_run_id`.
 *
 * Critically, this is a **render-only** component:
 *
 *   - The marker text / styling is built from the inline-joined
 *     `TaskRunSummary` (delivered via `MessagesResponse.taskRuns`
 *     from `/api/chat/sessions/[id]/messages`). No N+1 fetch per
 *     marker.
 *
 *   - Marker content is **never** stored in `message.content`. The
 *     association is `messages.task_run_id` (a foreign-key-ish
 *     column), so prompt builders constructing LLM context only
 *     read `content` and naturally exclude marker decoration. The
 *     v2 plan's earlier "sentinel string in message body" idea was
 *     rejected for exactly this reason — it would have polluted the
 *     model context.
 *
 *   - When the inline-join lookup is missing (a task got deleted
 *     while its messages remain), the marker silently degrades to
 *     a generic "task triggered" label rather than throwing.
 *
 * Heartbeat speak-up runs (`task_source === 'assistant_heartbeat'`)
 * get a slightly different label ("心跳触发 · {date} · 助理有事")
 * vs normal ai_task ("定时任务 · {date} · {status}"). Silent
 * heartbeats don't appear at all — the runner suppresses both the
 * assistant message AND the marker when output trims to
 * `HEARTBEAT_OK`.
 */
export function TaskRunMarker({ run }: { run: TaskRunSummary | undefined }) {
  const router = useRouter();
  const { t } = useTranslation();

  // Defensive: a deleted task / unknown run shouldn't crash the chat
  // page. Render nothing in that case — the message is still visible,
  // just without its origin badge.
  if (!run) return null;

  const isHeartbeat = run.task_source === 'assistant_heartbeat';
  const label = isHeartbeat
    ? t('chat.taskRunMarker.heartbeatLabel' as TranslationKey)
    : t('chat.taskRunMarker.taskLabel' as TranslationKey);

  // Status pill: green check for succeeded, X for failed/cancelled,
  // ⚠ for waiting_for_permission. Heartbeat speak-up renders as
  // "succeeded" semantically (model had something to say).
  let statusGlyph: React.ReactNode;
  let statusKey: TranslationKey;
  switch (run.status) {
    case 'succeeded':
    case 'success':
      statusGlyph = <CheckCircle size={12} className="text-status-success-foreground" />;
      statusKey = 'chat.taskRunMarker.succeeded' as TranslationKey;
      break;
    case 'failed':
    case 'error':
      statusGlyph = <XIcon size={12} className="text-status-error-foreground" />;
      statusKey = 'chat.taskRunMarker.failed' as TranslationKey;
      break;
    case 'waiting_for_permission':
      statusGlyph = <CodexWebIcon name="assistant" size={12} className="text-status-warning-foreground" aria-hidden />;
      statusKey = 'chat.taskRunMarker.waitingForPermission' as TranslationKey;
      break;
    case 'cancelled':
      statusGlyph = <XIcon size={12} className="text-muted-foreground" />;
      statusKey = 'chat.taskRunMarker.cancelled' as TranslationKey;
      break;
    default:
      statusGlyph = <CodexWebIcon name="assistant" size={12} className="text-muted-foreground" aria-hidden />;
      statusKey = 'chat.taskRunMarker.running' as TranslationKey;
  }

  const localTime = (() => {
    try {
      return new Date(run.created_at).toLocaleString();
    } catch {
      return run.created_at;
    }
  })();

  return (
    <div className="flex items-center gap-2 my-3 px-2">
      <div className="flex-1 h-px bg-border/40" />
      <button
        type="button"
        onClick={() => {
          // Navigate to the task detail row in the global Tasks page
          // — works for both ai_task and heartbeat runs (both are
          // stored in scheduled_tasks).
          router.push(`/settings/tasks?focus=${encodeURIComponent(run.task_id)}`);
        }}
        className="flex items-center gap-1.5 rounded-full border border-border/40 bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        title={run.task_name || label}
      >
        {statusGlyph}
        <span>{label}</span>
        <span className="text-muted-foreground/70">·</span>
        <span>{localTime}</span>
        <span className="text-muted-foreground/70">·</span>
        <span>{t(statusKey)}</span>
      </button>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}
