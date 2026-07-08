'use client';

/**
 * Phase 6 Phase 2a — 10-row breakdown list for the chat Context popover.
 *
 * Replaces the legacy ContextInputUsage / ContextOutputUsage / ContextCacheUsage
 * three-row block. Each row shows: color dot + user-facing label + token count
 * (right-aligned, tabular-nums for vertical alignment).
 *
 * Pending kinds (files_attachments / pending_next_turn) render with a dashed
 * outline + muted text so the user can tell "what would join the next turn"
 * apart from "already used".
 *
 * Dot colors come from `--context-dot-{kebab-kind}` CSS variables defined in
 * `src/app/globals.css`. Same OKLCH palette in light and dark theme.
 *
 * Subcomponent of ContextUsageIndicator / RunCockpitPopoverContent — not a
 * standalone mount surface (Phase 6 design: no third parallel entry).
 *
 * i18n (Codex P1 finding 2026-05-19): labels go through useTranslation, not
 * `part.label`. The data-layer DEFAULT_LABELS are Chinese-only fallbacks for
 * non-React consumers; rendering them directly mixed Chinese into the English
 * UI. Each kind maps to a `runStatus.breakdown*` key via LABEL_KEY below.
 */

import type {
  ContextBreakdownPart,
  ContextUsageBreakdown,
} from '@/lib/context-breakdown';
import { PENDING_BREAKDOWN_KINDS } from '@/lib/context-breakdown';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';

const PENDING_SET = new Set<ContextBreakdownPart['kind']>(PENDING_BREAKDOWN_KINDS);

// Codex P1 (2026-05-19): UI labels must go through i18n. DEFAULT_LABELS in
// context-breakdown.ts is fallback / debug only — see that file's docstring.
const LABEL_KEY: Record<ContextBreakdownPart['kind'], TranslationKey> = {
  system_prompt: 'runStatus.breakdownSystemPrompt' as TranslationKey,
  tools: 'runStatus.breakdownTools' as TranslationKey,
  rules: 'runStatus.breakdownRules' as TranslationKey,
  skills: 'runStatus.breakdownSkills' as TranslationKey,
  mcp: 'runStatus.breakdownMcp' as TranslationKey,
  memory: 'runStatus.breakdownMemory' as TranslationKey,
  files_attachments: 'runStatus.breakdownFilesAttachments' as TranslationKey,
  conversation: 'runStatus.breakdownConversation' as TranslationKey,
  pending_next_turn: 'runStatus.breakdownPendingNextTurn' as TranslationKey,
  cache_or_previous: 'runStatus.breakdownCacheOrPrevious' as TranslationKey,
};

function dotVar(kind: ContextBreakdownPart['kind']): string {
  // Map kind enum (snake_case) to CSS variable (kebab-case).
  return `var(--context-dot-${kind.replace(/_/g, '-')})`;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(n);
}

export interface ContextBreakdownListProps {
  breakdown: ContextUsageBreakdown;
  /** Hide rows whose tokens === 0. Default true. */
  hideZero?: boolean;
  className?: string;
}

export function ContextBreakdownList({
  breakdown,
  hideZero = true,
  className,
}: ContextBreakdownListProps) {
  const { t } = useTranslation();
  const visibleParts = hideZero
    ? breakdown.parts.filter((p) => p.tokens > 0)
    : breakdown.parts;

  if (visibleParts.length === 0) return null;

  return (
    <ul className={cn('flex flex-col gap-1.5 text-xs', className)}>
      {visibleParts.map((part) => {
        const isPending = PENDING_SET.has(part.kind);
        return (
          <li
            key={part.kind}
            className={cn(
              'flex items-center justify-between gap-3',
              isPending && 'text-muted-foreground',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  // rounded-[2px] (not rounded-sm) so the dot reads as a
                  // crisp rounded-rect — same radius as the dot-matrix
                  // cells above. rounded-sm at size 10px shaved the
                  // corners enough to read as "圆形" per Codex/user review.
                  'inline-block size-2.5 rounded-[2px] shrink-0',
                  isPending && 'border border-dashed border-muted-foreground bg-transparent',
                )}
                style={isPending ? undefined : { backgroundColor: dotVar(part.kind) }}
              />
              {/* Codex P2 (2026-05-19): label inherits row color, no forced
                  text-foreground — otherwise the row's text-muted-foreground
                  (applied when isPending) gets overridden and the pending
                  label never actually dims. */}
              <span className="truncate">{t(LABEL_KEY[part.kind])}</span>
            </span>
            <span className="font-mono shrink-0 tabular-nums">
              {formatTokens(part.tokens)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
