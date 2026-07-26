'use client';

import type { MessageContentBlock } from '@/types';
import { MessageResponse } from '@/components/ai-elements/message';
import { useTranslation } from '@/hooks/useTranslation';

type ProposedPlanBlock = Extract<MessageContentBlock, { type: 'codex_proposed_plan' }>;

export function ProposedPlanMessageBlock({ block }: { block: ProposedPlanBlock }) {
  const { t } = useTranslation();

  return (
    <section className="my-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{t('chat.plan.proposedTitle')}</h3>
        <span className="shrink-0 text-[10px] text-muted-foreground/60">{block.sourceBreadcrumb}</span>
      </div>
      <div className="text-sm">
        <MessageResponse>{block.text}</MessageResponse>
      </div>
    </section>
  );
}
