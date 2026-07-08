'use client';

import type { LanguageModelUsage } from 'ai';
import type { Message } from '@/types';
import { useContextUsage } from '@/hooks/useContextUsage';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextCacheUsage,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from '@/components/ai-elements/context';

interface ContextUsageIndicatorProps {
  messages: Message[];
  modelName: string;
  context1m?: boolean;
  hasSummary?: boolean;
  upstreamModelId?: string;
  contextUsageSnapshot?: {
    totalTokens: number;
    maxTokens: number;
    capturedAt: number;
  };
}

function formatTokensCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(n);
}

export function ContextUsageIndicator({
  messages,
  modelName,
  context1m,
  hasSummary,
  upstreamModelId,
  contextUsageSnapshot,
}: ContextUsageIndicatorProps) {
  const { t } = useTranslation();
  const usage = useContextUsage(messages, modelName, {
    context1m,
    hasSummary,
    upstreamModelId,
    snapshot: contextUsageSnapshot,
  });

  // Render only after at least one assistant turn has produced real
  // token data. Pre-first-response, hasData=false but contextWindow may
  // still be inferred from the model — rendering then shows "0%" with
  // an empty breakdown, which reads as "unlimited" to the user instead
  // of "no data yet". Skip until we have authoritative numbers.
  if (!usage.hasData) return null;

  // Capacity unknown branch: when the model's context window can't be
  // resolved we drop the percentage / progress entirely (otherwise the
  // ai-elements `Context` shows ∞% or NaN%, which Codex flagged as
  // breaking trust). Surface "已用 N · 容量未知" with an explanatory
  // popover instead.
  const capacityUnknown = !usage.contextWindow || usage.contextWindow <= 0;

  if (capacityUnknown) {
    return (
      <HoverCard openDelay={0} closeDelay={0}>
        <HoverCardTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-[10px] font-normal text-muted-foreground"
          >
            <span>{formatTokensCompact(usage.used)}</span>
            <span className="opacity-60">·</span>
            <span>{t('context.unknownCapacity' as TranslationKey)}</span>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="end" className="min-w-60 p-3 text-xs">
          <p className="text-foreground font-medium">
            {t('context.unknownCapacity' as TranslationKey)}
          </p>
          <p className="mt-1 text-muted-foreground leading-snug">
            {t('context.unknownCapacityHint' as TranslationKey)}
          </p>
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span className="text-muted-foreground">
              {t('context.used' as TranslationKey)}
            </span>
            <span className="font-mono">{formatTokensCompact(usage.used)}</span>
          </div>
          {usage.outputTokens > 0 && (
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">
                {t('context.outputTokens' as TranslationKey)}
              </span>
              <span className="font-mono">
                {formatTokensCompact(usage.outputTokens)}
              </span>
            </div>
          )}
        </HoverCardContent>
      </HoverCard>
    );
  }

  // Capacity known: use ai-elements Context with full progress + breakdown.
  // `used` already includes cache; recover the raw input slice for the
  // breakdown panel so cache and input don't double-count.
  const inputTokens = Math.max(
    0,
    usage.used - usage.cacheReadTokens - usage.cacheCreationTokens,
  );
  const lmUsage: LanguageModelUsage = {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheCreationTokens,
    },
    outputTokens: usage.outputTokens,
    outputTokenDetails: {
      textTokens: usage.outputTokens,
      reasoningTokens: undefined,
    },
    totalTokens: usage.used + usage.outputTokens,
    cachedInputTokens: usage.cacheReadTokens,
  };

  return (
    <Context
      usedTokens={usage.used}
      maxTokens={usage.contextWindow as number}
      usage={lmUsage}
    >
      <ContextTrigger size="xs" className="text-[10px] font-normal" />
      <ContextContent side="top" align="end">
        <ContextContentHeader />
        <ContextContentBody className="space-y-1.5">
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextCacheUsage />
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}
