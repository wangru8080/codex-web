'use client';

/**
 * TaskCheckpoint — inline TODO panel above the chat composer.
 *
 * UX contract:
 *   1. Position: directly above MessageInput, the user reads it before
 *      typing the next instruction.
 *   2. Default: expanded — shows all task items with a numbered list.
 *   3. Minimize: top-right toggle. When minimized, only the summary
 *      header ("共 N 个任务，已经完成 M 个") is visible.
 *   4. Auto-hide: when there are zero tasks OR all tasks are completed,
 *      the component renders nothing. The user is never asked to dismiss
 *      a stale checklist by hand.
 *
 * Data: re-uses the existing `/api/tasks?session_id=` endpoint and the
 * `tasks-updated` window event the SDK fires when TodoWrite syncs.
 * Click-to-toggle a task's completion state is preserved from the
 * sidebar TaskList — the previous component stays for now and we'll
 * remove the sidebar mount in ChatView's surrounding patch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowsIn, ArrowsOut } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { TaskItem, TaskStatus } from '@/types';
import { cn } from '@/lib/utils';

interface TaskCheckpointProps {
  sessionId: string;
  className?: string;
}

export function TaskCheckpoint({ sessionId, className }: TaskCheckpointProps) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [minimized, setMinimized] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/tasks?session_id=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      // Silent fail — the panel just stays empty (and therefore hidden).
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // SDK TodoWrite sync — same event the sidebar TaskList listened for.
  useEffect(() => {
    const handler = () => { fetchTasks(); };
    window.addEventListener('tasks-updated', handler);
    return () => window.removeEventListener('tasks-updated', handler);
  }, [fetchTasks]);

  const handleToggle = useCallback(async (task: TaskItem) => {
    const nextStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setTasks((prev) => prev.map((task2) => (task2.id === task.id ? data.task : task2)));
    } catch {
      // Silent fail — next /api/tasks fetch will reconcile.
    }
  }, []);

  const completedCount = useMemo(() => tasks.filter((task2) => task2.status === 'completed').length, [tasks]);
  const allDone = tasks.length > 0 && completedCount === tasks.length;

  // Auto-hide: no tasks at all, or every task is complete. The whole
  // point of the panel is "what's next" — when there's nothing next,
  // it has no business taking up vertical space.
  if (tasks.length === 0 || allDone) return null;

  const summary = t('taskCheckpoint.summary' as TranslationKey, {
    total: tasks.length,
    done: completedCount,
  });

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-3xl px-4',
        className,
      )}
      data-task-checkpoint
      data-task-minimized={minimized || undefined}
    >
      <div className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3">
        {/* Header: list icon + summary on the left, minimize toggle on
            the right. The toggle aria-label flips so screen readers
            announce the action they're about to perform. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <CodexWebIcon name="task" size="sm" className="shrink-0" aria-hidden />
            <span className="truncate">{summary}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setMinimized((prev) => !prev)}
            aria-label={t(
              (minimized ? 'taskCheckpoint.expand' : 'taskCheckpoint.minimize') as TranslationKey,
            )}
            className="shrink-0 text-muted-foreground/70 hover:text-foreground"
          >
            {minimized ? <ArrowsOut size={14} /> : <ArrowsIn size={14} />}
          </Button>
        </div>

        {/* Body — numbered list. Click a row to toggle the task's
            completion state (same behavior as the old sidebar TaskList).
            in_progress / failed states render with the same circle for
            now; richer state glyphs can be a follow-up. */}
        {!minimized && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {tasks.map((task, idx) => {
              const isDone = task.status === 'completed';
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => handleToggle(task)}
                    className="group flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent/40"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        isDone
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-muted-foreground/40 group-hover:border-foreground/60',
                      )}
                    >
                      {isDone && (
                        <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2.5 6l2.5 2.5 4.5-5" />
                        </svg>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground/60 tabular-nums">{idx + 1}.</span>
                    <span
                      className={cn(
                        'flex-1 text-sm leading-snug',
                        isDone ? 'text-muted-foreground line-through' : 'text-foreground',
                      )}
                    >
                      {task.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
