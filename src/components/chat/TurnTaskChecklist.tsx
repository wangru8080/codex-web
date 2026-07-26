'use client';

import type { ComposerTurnPlan } from '@/codex-web/composer-turn-plan';
import { Check, SpinnerGap } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export function TurnTaskChecklist({
  steps,
  compact = false,
}: {
  steps: ComposerTurnPlan['steps'];
  compact?: boolean;
}) {
  return (
    <ol className={cn('space-y-1.5', compact && 'space-y-1')} data-testid="turn-task-checklist">
      {steps.map((step, index) => (
        <li
          key={`${index}-${step.step}`}
          data-task-status={step.status}
          className={cn(
            'grid min-w-0 grid-cols-[1rem_1.25rem_minmax(0,1fr)] items-start gap-1.5 text-sm',
            compact && 'text-xs',
            step.status === 'completed' && 'text-muted-foreground',
            step.status === 'inProgress' && 'text-foreground',
            step.status === 'pending' && 'text-muted-foreground',
          )}
        >
          <span className="flex size-4 items-center justify-center" aria-hidden>
            {step.status === 'completed' ? (
              <span className="flex size-4 items-center justify-center rounded-full bg-muted-foreground text-background">
                <Check size={11} weight="bold" />
              </span>
            ) : step.status === 'inProgress' ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <span className="size-4 rounded-full border border-muted-foreground/55" />
            )}
          </span>
          <span className="text-right tabular-nums text-muted-foreground/75">{index + 1}.</span>
          <span
            className={cn(
              'min-w-0 break-words',
              step.status === 'completed' && 'line-through decoration-muted-foreground/70',
            )}
          >
            {step.step}
          </span>
        </li>
      ))}
    </ol>
  );
}
