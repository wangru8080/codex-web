'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { ThreadGoal } from '@/codex/protocol/generated/v2/ThreadGoal';
import type { ThreadGoalStatus } from '@/codex/protocol/generated/v2/ThreadGoalStatus';
import type { AppServerTurnStatus } from '@/codex-web/turn-reducer';
import {
  formatGoalElapsedSeconds,
  goalObjectiveLabel,
  liveGoalElapsedSeconds,
} from '@/codex-web/goal-display-adapter';
import { Button } from '@/components/ui/button';
import { NotePencil, Play, Trash } from '@/components/ui/icon';
import { Pause, Target } from '@/components/ui/icon';

type GoalProgressRowProps = {
  goal: ThreadGoal;
  sourceBreadcrumb: string;
  turnStatus?: AppServerTurnStatus;
  turnStartedAtMs?: number;
  pending?: boolean;
  onStatusChange?: (status: ThreadGoalStatus) => void | Promise<void>;
  onEdit?: () => void;
  onClear?: () => void | Promise<void>;
};

export function GoalProgressRow({
  goal,
  sourceBreadcrumb,
  turnStatus,
  turnStartedAtMs,
  pending,
  onStatusChange,
  onEdit,
  onClear,
}: GoalProgressRowProps) {
  const canResume =
    goal.status === 'paused' ||
    goal.status === 'blocked' ||
    goal.status === 'usageLimited';
  const canPause = goal.status === 'active';
  const [observedAtMs, setObservedAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(observedAtMs);

  useEffect(() => {
    const observedAt = Date.now();
    setObservedAtMs(observedAt);
    setNowMs(observedAt);
  }, [goal.status, goal.timeUsedSeconds, goal.updatedAt]);

  useEffect(() => {
    if (goal.status !== 'active' || turnStatus !== 'running') return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [goal.status, observedAtMs, turnStatus]);

  const { locale } = useTranslation();
  const isEnglish = locale === 'en';
  const elapsed = liveGoalElapsedSeconds({
    goal,
    observedAtMs,
    nowMs,
    turnStartedAtMs,
    turnStatus,
  });
  const statusLabel = goal.status === 'active'
    ? (isEnglish ? 'Active Goal' : '进行中的目标')
    : goal.status === 'complete'
      ? (isEnglish ? 'Completed Goal' : '已完成的目标')
      : goal.status === 'budgetLimited'
        ? (isEnglish ? 'Unfinished Goal' : '未完成的目标')
        : (isEnglish ? 'Paused Goal' : '已暂停的目标');

  return (
    <div
      className="mx-auto -mb-px flex min-h-11 w-[calc(100%-2rem)] max-w-[45rem] items-center gap-2 rounded-t-lg border border-border/70 bg-background px-3 py-2"
      data-goal-source={sourceBreadcrumb}
      data-goal-status={goal.status}
    >
      <Target size={17} className="shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
        <span className="shrink-0 font-semibold text-foreground">{statusLabel}</span>
        <span className="truncate text-muted-foreground" title={goal.objective}>
          {goalObjectiveLabel(goal)}
        </span>
        <span className="shrink-0 text-muted-foreground">·</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatGoalElapsedSeconds(elapsed)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {(canPause || canResume) && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pending || !onStatusChange}
            onClick={() => onStatusChange?.(canResume ? 'active' : 'paused')}
            aria-label={canResume ? (isEnglish ? 'Resume goal' : '恢复目标') : (isEnglish ? 'Pause goal' : '暂停目标')}
            title={canResume ? (isEnglish ? 'Resume goal' : '恢复目标') : (isEnglish ? 'Pause goal' : '暂停目标')}
          >
            {canResume ? <Play size={13} /> : <Pause size={13} />}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={pending || !onEdit}
          onClick={onEdit}
          aria-label={isEnglish ? 'Edit goal' : '编辑目标'}
          title={isEnglish ? 'Edit goal' : '编辑目标'}
        >
          <NotePencil size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={pending || !onClear}
          onClick={() => onClear?.()}
          aria-label={isEnglish ? 'Clear goal' : '清除目标'}
          title={isEnglish ? 'Clear goal' : '清除目标'}
        >
          <Trash size={13} />
        </Button>
      </div>
    </div>
  );
}
