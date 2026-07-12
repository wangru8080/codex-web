'use client';

import type { MessageContentBlock } from '@/types';
import { MessageResponse } from '@/components/ai-elements/message';
import { Check } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

type ProposedPlanBlock = Extract<MessageContentBlock, { type: 'codex_proposed_plan' }>;
type UpdatedPlanBlock = Extract<MessageContentBlock, { type: 'codex_updated_plan' }>;

export function ProposedPlanMessageBlock({ block }: { block: ProposedPlanBlock }) {
  return (
    <section className="my-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Proposed Plan</h3>
        <span className="shrink-0 text-[10px] text-muted-foreground/60">{block.sourceBreadcrumb}</span>
      </div>
      <div className="text-sm">
        <MessageResponse>{block.text}</MessageResponse>
      </div>
    </section>
  );
}

export function UpdatedPlanMessageBlock({ block }: { block: UpdatedPlanBlock }) {
  return (
    <section className="my-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Updated Plan</h3>
        <span className="shrink-0 text-[10px] text-muted-foreground/60">{block.sourceBreadcrumb}</span>
      </div>
      {block.explanation && (
        <p className="mb-2 text-xs italic text-muted-foreground">{block.explanation}</p>
      )}
      {block.steps.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">(no steps provided)</p>
      ) : (
        <ol className="space-y-1.5">
          {block.steps.map((step, index) => (
            <li
              key={`${step.status}-${index}-${step.step}`}
              className={cn(
                'flex min-w-0 items-start gap-2 text-sm',
                step.status === 'completed' && 'text-muted-foreground line-through',
                step.status === 'inProgress' && 'font-medium text-foreground',
                step.status === 'pending' && 'text-muted-foreground',
              )}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {step.status === 'completed' ? (
                  <Check size={13} />
                ) : (
                  <span
                    className={cn(
                      'size-2.5 rounded-full border',
                      step.status === 'inProgress'
                        ? 'border-primary bg-primary/20'
                        : 'border-muted-foreground/40',
                    )}
                  />
                )}
              </span>
              <span className="min-w-0 break-words">{step.step}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

