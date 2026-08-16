'use client';

import { Article } from '@/components/ui/icon';

import { Shimmer } from '@/components/ai-elements/shimmer';
import { useTranslation } from '@/hooks/useTranslation';
import type { MessageContentBlock } from '@/types';

type ContextCompactionBlock = Extract<MessageContentBlock, { type: 'codex_context_compaction' }>;

export function ContextCompactionRow({ block }: { block: ContextCompactionBlock }) {
  const { t } = useTranslation();
  const running = block.status === 'inProgress';
  const label = t(running ? 'chat.contextCompaction.running' : 'chat.contextCompaction.completed');

  return (
    <div
      className="flex min-h-10 items-center gap-2 px-2 py-2 text-sm text-muted-foreground"
      data-context-compaction-status={block.status}
      data-source-breadcrumb={block.sourceBreadcrumb}
    >
      <Article aria-hidden size={18} weight="regular" />
      {running ? <Shimmer>{label}</Shimmer> : <span>{label}</span>}
    </div>
  );
}
