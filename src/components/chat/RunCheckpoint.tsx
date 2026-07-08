'use client';

/**
 * RunCheckpoint — single inline-banner component that renders the
 * trust-layer reasons returned from `buildCheckpoints`. Lives in the
 * chat composer area, above MessageInput.
 *
 * Round 1 visual contract (see `docs/exec-plans/active/chat-run-checkpoint.md`):
 *   - Inline banner only (NOT modal, NOT dialog, NOT settings toggle)
 *   - One severity tone per reason: error (red) / warning (amber) /
 *     info (blue), driven by `tone` from the builder
 *   - One primary action per banner (label + nav target)
 *   - Renders nothing when reasons[] is empty — composer stays as-is
 *
 * Existing scattered banners (RateLimitBanner / TerminalReasonChip /
 * PermissionPrompt / chat-page invalid-default) remain in place for
 * Round 1 as their state machines are separate; visual unification
 * comes from sharing the same `bg-status-*-muted` tokens (see Round 1
 * plan: "暂保留为复用通道，但视觉 align").
 */

import { useRouter } from 'next/navigation';
import { Warning, XCircle, Info } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { CheckpointActionId, CheckpointReason, CheckpointTone } from '@/lib/run-checkpoint';
import { cn } from '@/lib/utils';

interface RunCheckpointProps {
  reasons: ReadonlyArray<CheckpointReason>;
  className?: string;
  /**
   * Optional handler for action-id-based reasons (Round 2:
   * `confirm-context-cost`). When the
   * banner's action carries an `actionId` and this prop is provided,
   * the handler runs instead of the default `href` navigation.
   * Used by chat/page.tsx + ChatView to wire the confirm-and-send
   * flow.
   */
  onAction?: (actionId: CheckpointActionId) => void;
}

const TONE_CLASSES: Record<CheckpointTone, string> = {
  // Same tokens as TerminalReasonChip and RateLimitBanner so the three
  // surfaces read as the same visual family even though the state
  // machines are distinct (Round 1 unification — see plan §B).
  error: 'border-status-error-muted bg-status-error-muted text-status-error-foreground',
  warning: 'border-status-warning-muted bg-status-warning-muted text-status-warning-foreground',
  info: 'border-status-info-muted bg-status-info-muted text-status-info-foreground',
};

const TONE_ICON: Record<CheckpointTone, typeof Warning> = {
  error: XCircle,
  warning: Warning,
  info: Info,
};

export function RunCheckpoint({ reasons, className, onAction }: RunCheckpointProps) {
  const { t } = useTranslation();
  const router = useRouter();

  if (reasons.length === 0) return null;

  return (
    <div
      className={cn('mx-auto flex w-full max-w-3xl flex-col gap-2 px-4', className)}
      data-run-checkpoint
    >
      {reasons.map((reason) => {
        const Icon = TONE_ICON[reason.tone];
        const handleAction = () => {
          // Precedence:
          //   1. confirm-* actionId + onAction → invoke handler (Round 2
          //      "confirm and send" wiring; the page sets state +
          //      dispatches the run-checkpoint-confirm-send event).
          //   2. explicit onClick → invoke
          //   3. href → router.push
          // We deliberately DO NOT invoke onAction for open-* actionIds
          // (open-providers / open-runtime). Those reasons carry an
          // href and the user expects "前往修复" to navigate to settings.
          // Earlier the component swallowed every actionId when onAction
          // was provided, breaking the Round 1 navigation flow. (Codex
          // P1, 2026-04-30.)
          const isConfirmAction =
            reason.action?.actionId === 'confirm-context-cost';
          if (isConfirmAction && onAction) {
            onAction(reason.action!.actionId!);
            return;
          }
          if (reason.action?.onClick) {
            reason.action.onClick();
            return;
          }
          if (reason.action?.href) {
            // `/settings/xxx` route-level paths — Next.js router.push handles
            // SPA navigation directly into the section without paying the
            // /settings root redirect compile cost.
            router.push(reason.action.href);
          }
        };
        return (
          <div
            key={reason.id}
            data-checkpoint-reason={reason.id}
            data-checkpoint-tone={reason.tone}
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
              TONE_CLASSES[reason.tone],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {t(reason.titleKey as TranslationKey)}
              </p>
              {reason.descriptionKey && (
                <p className="mt-0.5 text-xs opacity-90">
                  {t(reason.descriptionKey as TranslationKey, reason.descriptionValues)}
                </p>
              )}
            </div>
            {reason.action && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAction}
                className="h-6 shrink-0 px-2 text-xs"
              >
                {t(reason.action.labelKey as TranslationKey)}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
