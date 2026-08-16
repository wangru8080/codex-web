'use client';

import { useEffect, useState } from 'react';
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

  const elapsed = liveGoalElapsedSeconds({
    goal,
    observedAtMs,
    nowMs,
    turnStartedAtMs,
    turnStatus,
  });
  const statusLabel = goal.status === 'active'
    ? '进行中的目标'
    : goal.status === 'complete'
      ? '已完成的目标'
      : goal.status === 'budgetLimited'
        ? '未完成的目标'
        : '已暂停的目标';

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
            aria-label={canResume ? '恢复目标' : '暂停目标'}
            title={canResume ? '恢复目标' : '暂停目标'}
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
          aria-label="编辑目标"
          title="编辑目标"
        >
          <NotePencil size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={pending || !onClear}
          onClick={() => onClear?.()}
          aria-label="清除目标"
          title="清除目标"
        >
          <Trash size={13} />
        </Button>
      </div>
    </div>
  );
}
