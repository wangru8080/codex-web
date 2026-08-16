'use client';

import { useId } from 'react';
import { ListChecks } from '@/components/ui/icon';

import type { ComposerTurnPlan as ComposerTurnPlanData } from '@/codex-web/composer-turn-plan';
import { CaretDown, CaretUp } from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';

import { TurnTaskChecklist } from './TurnTaskChecklist';

export function ComposerTurnPlan({
  plan,
  expanded,
  onExpandedChange,
  variant,
}: {
  plan: ComposerTurnPlanData | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  variant: 'standalone' | 'compact';
}) {
  const { t } = useTranslation();
  const panelId = useId();

  if (!plan) return null;

  const completed = plan.steps.filter((step) => step.status === 'completed').length;
  const total = plan.steps.length;

  if (variant === 'standalone') {
    return (
      <section
        className="w-full overflow-hidden rounded-lg border border-border/70 bg-popover shadow-[var(--shadow-diffuse)]"
        data-testid="composer-turn-plan-standalone"
        data-source-breadcrumb={plan.sourceBreadcrumb}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={t('composer.turnPlan.open' as TranslationKey)}
          className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-accent/60"
          data-testid="composer-turn-plan"
          onClick={() => onExpandedChange(!expanded)}
        >
          <ListChecks size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 font-semibold tabular-nums">
            {t('composer.turnPlan.summary' as TranslationKey, { completed, total })}
          </span>
          {expanded ? <CaretUp size={15} aria-hidden /> : <CaretDown size={15} aria-hidden />}
        </button>
        {expanded && (
          <div id={panelId} className="max-h-72 overflow-y-auto px-3 pb-3" data-testid="composer-turn-plan-panel">
            <TurnTaskChecklist steps={plan.steps} />
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      {expanded && (
        <div
          id={panelId}
          className="absolute bottom-full left-1/2 z-30 mb-2 max-h-72 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-lg border border-border/70 bg-popover px-3 py-2.5 shadow-[var(--shadow-diffuse)]"
          data-testid="composer-turn-plan-panel"
          data-source-breadcrumb={plan.sourceBreadcrumb}
        >
          <TurnTaskChecklist steps={plan.steps} compact />
        </div>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={t('composer.turnPlan.open' as TranslationKey)}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3 text-xs tabular-nums shadow-sm transition-colors',
          expanded
            ? 'border-foreground bg-foreground text-background hover:bg-foreground/90'
            : 'bg-background/95 text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
        data-testid="composer-turn-plan"
        data-variant="compact"
        onClick={() => onExpandedChange(!expanded)}
      >
        <ListChecks size={15} aria-hidden />
        <span>{completed}/{total}</span>
      </button>
    </>
  );
}
