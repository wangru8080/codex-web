'use client';

import type { PlanImplementationPrompt } from '@/codex-web/plan-implementation-adapter';
import { Button } from '@/components/ui/button';
import { CheckCircle, X } from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';

type PlanImplementationPromptBarProps = {
  prompt: PlanImplementationPrompt;
  disabled?: boolean;
  onImplement?: (message: string) => void | Promise<void>;
  onClearContextImplement?: (message: string) => void | Promise<void>;
  onStay?: () => void;
};

export function PlanImplementationPromptBar({
  prompt,
  disabled,
  onImplement,
  onClearContextImplement,
  onStay,
}: PlanImplementationPromptBarProps) {
  const { t } = useTranslation();
  const implement = prompt.actions.find((action) => action.id === 'implement');
  const clearContext = prompt.actions.find((action) => action.id === 'clearContext');
  const stay = prompt.actions.find((action) => action.id === 'stay');

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <CheckCircle size={15} className="text-muted-foreground" />
        <span>{t('chat.plan.implementationTitle')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {implement && (
          <Button
            type="button"
            size="sm"
            disabled={disabled || !!implement.disabledReason || !implement.userMessage || !onImplement}
            title={implement.disabledReason}
            onClick={() => implement.userMessage && onImplement?.(implement.userMessage)}
          >
            {t('chat.plan.implement')}
          </Button>
        )}
        {clearContext && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !!clearContext.disabledReason || !clearContext.userMessage || !onClearContextImplement}
            title={clearContext.disabledReason}
            onClick={() => clearContext.userMessage && onClearContextImplement?.(clearContext.userMessage)}
          >
            {t('chat.plan.clearContextImplement')}
          </Button>
        )}
        {stay && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onStay}
          >
            <X size={13} />
            {t('chat.plan.stay')}
          </Button>
        )}
      </div>
    </div>
  );
}
