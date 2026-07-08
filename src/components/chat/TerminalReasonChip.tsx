/**
 * TerminalReasonChip — renders a contextual end-of-turn status chip based on
 * `SDKResultMessage.terminal_reason` (SDK 0.2.111+).
 *
 * Phase 1 of agent-sdk-0-2-111-adoption: additive display layer. Does NOT
 * replace error-classifier.ts — errors without a result message continue to
 * flow through the existing classifier pipeline.
 *
 * Only renders for reasons that carry information users can act on or interpret.
 * Silent for `completed` (normal) and `aborted_*` (user-initiated).
 */

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

/**
 * Actions a user can take from the chip. Each maps to a handler in
 * ChatView that wires it to the corresponding subsystem (compressor,
 * context1m toggle, model switch, router, etc.). "requiresConfirm"
 * actions pop a 2nd-step AlertDialog before the destructive step runs
 * (per feedback_no_silent_auto_irreversible memory).
 */
export type TerminalActionId =
  | 'compress_and_retry'
  | 'enable_1m_and_retry'
  | 'compress_only'
  | 'switch_to_sonnet'
  | 'continue_max_turns'
  | 'open_hook_settings'
  | 'retry_simple'
  | 'retry_image_upload';

interface Props {
  reason: string | undefined;
  onAction?: (actionId: TerminalActionId) => void;
}

type Tone = 'warning' | 'error' | 'info' | 'muted';

interface ActionDescriptor {
  id: TerminalActionId;
  /** i18n key under 'terminalAction.*' for the button label */
  labelKey: TranslationKey;
  /** Primary actions use a filled button; secondary use ghost */
  variant: 'primary' | 'secondary';
}

// Per-reason action mapping. Order in the array = visual order.
const ACTIONS_BY_REASON: Record<string, ActionDescriptor[]> = {
  prompt_too_long: [
    { id: 'compress_and_retry', labelKey: 'terminalAction.compressAndRetry' as TranslationKey, variant: 'primary' },
    { id: 'enable_1m_and_retry', labelKey: 'terminalAction.enable1mAndRetry' as TranslationKey, variant: 'secondary' },
    { id: 'compress_only', labelKey: 'terminalAction.compressOnly' as TranslationKey, variant: 'secondary' },
  ],
  blocking_limit: [
    { id: 'switch_to_sonnet', labelKey: 'terminalAction.switchToSonnet' as TranslationKey, variant: 'primary' },
  ],
  rapid_refill_breaker: [
    { id: 'switch_to_sonnet', labelKey: 'terminalAction.switchToSonnet' as TranslationKey, variant: 'primary' },
  ],
  max_turns: [
    { id: 'continue_max_turns', labelKey: 'terminalAction.continue' as TranslationKey, variant: 'primary' },
  ],
  hook_stopped: [
    { id: 'open_hook_settings', labelKey: 'terminalAction.openHookSettings' as TranslationKey, variant: 'secondary' },
  ],
  stop_hook_prevented: [
    { id: 'open_hook_settings', labelKey: 'terminalAction.openHookSettings' as TranslationKey, variant: 'secondary' },
  ],
  image_error: [
    { id: 'retry_image_upload', labelKey: 'terminalAction.retryImageUpload' as TranslationKey, variant: 'primary' },
  ],
  model_error: [
    { id: 'retry_simple', labelKey: 'terminalAction.retry' as TranslationKey, variant: 'primary' },
  ],
  // tool_deferred handled by Phase 7b's deferred-tool card, no action here.
};

const TONE_BY_REASON: Record<string, Tone> = {
  max_turns: 'warning',
  prompt_too_long: 'error',
  blocking_limit: 'error',
  rapid_refill_breaker: 'error',
  image_error: 'error',
  model_error: 'error',
  stop_hook_prevented: 'muted',
  hook_stopped: 'muted',
  tool_deferred: 'info',
};

// Reasons that should render silently (no chip). Users either already know
// (they cancelled) or the turn completed normally.
const SILENT_REASONS = new Set(['completed', 'aborted_streaming', 'aborted_tools']);

// Whitelist of reasons we have explicit i18n labels for. Anything else
// (e.g. a future SDK value we haven't translated yet) renders under the
// 'unknown' key so the UI never leaks the raw reason string.
const KNOWN_REASONS = new Set([
  'max_turns',
  'prompt_too_long',
  'blocking_limit',
  'rapid_refill_breaker',
  'image_error',
  'model_error',
  'stop_hook_prevented',
  'hook_stopped',
  'tool_deferred',
]);

const TONE_CLASSES: Record<Tone, string> = {
  warning: 'bg-status-warning-muted text-status-warning-foreground border-status-warning-muted',
  error: 'bg-status-error-muted text-status-error-foreground border-status-error-muted',
  info: 'bg-status-info-muted text-status-info-foreground border-status-info-muted',
  muted: 'bg-muted text-muted-foreground border-border',
};

export function TerminalReasonChip({ reason, onAction }: Props) {
  const { t } = useTranslation();

  if (!reason || SILENT_REASONS.has(reason)) return null;

  // Use whitelist rather than `t(key) || t(fallback)` because translate()
  // returns the raw key when missing, so the `||` branch would never fire
  // and a new SDK reason would leak a "terminal.new_reason" string to the UI.
  const isKnown = KNOWN_REASONS.has(reason);
  const tone = TONE_BY_REASON[reason] ?? 'warning';
  const label = isKnown
    ? t(`terminal.${reason}` as TranslationKey)
    : t('terminal.unknown' as TranslationKey);
  const actions = onAction ? (ACTIONS_BY_REASON[reason] || []) : [];

  return (
    <div className="mx-auto mt-2 flex w-full max-w-3xl flex-wrap items-center justify-start gap-2 px-4">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
        data-terminal-reason={reason}
      >
        {label}
      </span>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onAction?.(action.id)}
          data-terminal-action={action.id}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            action.variant === 'primary'
              ? `${TONE_CLASSES[tone]} hover:opacity-90`
              : 'border-border bg-background text-foreground hover:bg-muted'
          }`}
        >
          {t(action.labelKey)}
        </button>
      ))}
    </div>
  );
}
