/**
 * RateLimitBanner — surfaces SDK 0.2.111 subscription rate-limit events
 * (SDKRateLimitInfo) on the chat page. Phase 2 of agent-sdk-0-2-111.
 *
 * UX contract (per feedback_no_silent_auto_irreversible memory):
 *   - status: 'allowed' → render nothing
 *   - status: 'allowed_warning' → dismissible yellow banner with
 *     utilization info and a "切换到 Sonnet" suggestion
 *   - status: 'rejected' → dismissible red banner with countdown + a
 *     "切换并重试" button that goes through an explicit confirm
 *     dialog. The last user message is preserved; the user can also
 *     dismiss the banner and handle the situation themselves.
 *
 * Subscription path only — this banner never renders for API-key or
 * third-party-proxy sessions because the SDK doesn't emit
 * rate_limit_event on those paths.
 */

'use client';

import { useState, useEffect } from 'react';
import { X } from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
  utilization?: number;
}

interface Props {
  info: RateLimitInfo | undefined;
  /** Called when the user clicks "switch to Sonnet". Parent handles
   *  confirmation + actual model switch. */
  onRequestSwitchToSonnet: () => void;
  /** Dismissal is session-local — parent tracks which sessions have a
   *  dismissed banner to avoid re-showing on the same info snapshot. */
  onDismiss: () => void;
}

function formatResetCountdown(resetsAt: number | undefined): string {
  if (!resetsAt) return '';
  const now = Date.now();
  const deltaMs = resetsAt * 1000 - now;
  if (deltaMs <= 0) return '';
  const totalMinutes = Math.floor(deltaMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const h = hours % 24;
    return `${days}天 ${h}小时`;
  }
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

export function RateLimitBanner({ info, onRequestSwitchToSonnet, onDismiss }: Props) {
  const { t } = useTranslation();
  // tick just forces a re-render every minute — the countdown text itself
  // is derived from info.resetsAt, not stored state, so we avoid the
  // setState-during-effect lint ping. resetsAt changes naturally trigger
  // a re-render through the caller, so we don't need to reset tick here.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!info?.resetsAt) return;
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [info?.resetsAt]);
  const countdown = formatResetCountdown(info?.resetsAt);

  if (!info || info.status === 'allowed') return null;

  const isRejected = info.status === 'rejected';
  const bucketKey = `rateLimit.bucket.${info.rateLimitType || 'unknown'}` as TranslationKey;

  return (
    <div
      className={`mx-auto w-full max-w-3xl px-4 py-2`}
      data-rate-limit-status={info.status}
    >
      <div
        className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
          isRejected
            ? 'border-status-error-muted bg-status-error-muted text-status-error-foreground'
            : 'border-status-warning-muted bg-status-warning-muted text-status-warning-foreground'
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            {isRejected
              ? t('rateLimit.rejectedTitle' as TranslationKey)
              : t('rateLimit.warningTitle' as TranslationKey)}
          </div>
          <div className="mt-0.5 text-xs opacity-90 truncate">
            {info.rateLimitType && <span>{t(bucketKey)}</span>}
            {info.utilization != null && (
              <span>{info.rateLimitType ? ' · ' : ''}{t('rateLimit.utilization' as TranslationKey)}: {Math.round(info.utilization * 100)}%</span>
            )}
            {countdown && (
              <span> · {t('rateLimit.resetsIn' as TranslationKey)}: {countdown}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRequestSwitchToSonnet}
          className="shrink-0 rounded-md border border-current px-2.5 py-1 text-xs font-medium hover:opacity-80"
        >
          {t('rateLimit.switchToSonnet' as TranslationKey)}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('rateLimit.dismiss' as TranslationKey)}
          className="shrink-0 rounded-md p-1 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
