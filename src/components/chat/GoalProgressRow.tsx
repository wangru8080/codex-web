'use client';

import type { ThreadGoal } from '@/codex/protocol/generated/v2/ThreadGoal';
import type { ThreadGoalStatus } from '@/codex/protocol/generated/v2/ThreadGoalStatus';
import { goalObjectiveLabel, goalProgressLabel } from '@/codex-web/goal-display-adapter';
import { Button } from '@/components/ui/button';
import { NotePencil, Play, X } from '@/components/ui/icon';
import { Pause, Target } from '@phosphor-icons/react';

type GoalProgressRowProps = {
  goal: ThreadGoal;
  sourceBreadcrumb: string;
  disabled?: boolean;
  onStatusChange?: (status: ThreadGoalStatus) => void | Promise<void>;
  onEdit?: () => void;
  onClear?: () => void | Promise<void>;
};

export function GoalProgressRow({
  goal,
  sourceBreadcrumb,
  disabled,
  onStatusChange,
  onEdit,
  onClear,
}: GoalProgressRowProps) {
  const canResume =
    goal.status === 'paused' ||
    goal.status === 'blocked' ||
    goal.status === 'usageLimited';
  const canPause = goal.status === 'active';

  return (
    <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <Target size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{goalProgressLabel(goal)}</div>
        <div className="truncate text-xs text-muted-foreground" title={goal.objective}>
          {goalObjectiveLabel(goal)}
        </div>
        <div className="truncate text-[10px] text-muted-foreground/60">{sourceBreadcrumb}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {(canPause || canResume) && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || !onStatusChange}
            onClick={() => onStatusChange?.(canResume ? 'active' : 'paused')}
            aria-label={canResume ? 'Resume goal' : 'Pause goal'}
          >
            {canResume ? <Play size={13} /> : <Pause size={13} />}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled || !onEdit}
          onClick={onEdit}
          aria-label="Edit goal"
        >
          <NotePencil size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled || !onClear}
          onClick={() => onClear?.()}
          aria-label="Clear goal"
        >
          <X size={13} />
        </Button>
      </div>
    </div>
  );
}
