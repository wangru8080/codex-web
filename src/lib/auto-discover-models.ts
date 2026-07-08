/**
 * Provider model auto-discovery — shared probe → apply → outcome flow.
 *
 * Two entry points:
 *   - `runAutoDiscoverForProvider`  — single provider, surfaces a single
 *     toast (loading → success/warning/info). Used by Add Service success
 *     and the per-provider "刷新" button on the Models page.
 *   - `probeAndApplyProvider`       — pure result, no toast. Building
 *     block for the Models page "刷新全部" path that aggregates many
 *     providers under one rolling progress toast.
 *
 * Both share the same conservative apply policy: enable_source guards
 * in `applyDiscoveryDiff` ensure user manual_enabled / manual_hidden
 * choices are never overwritten, so neither entry point shows a diff
 * preview dialog. The dedicated diff-preview UI is kept in
 * ProviderManager.handleDiscoverModels for the rare advanced user.
 */

import { showToast, updateToast } from '@/hooks/useToast';
import type { TranslationKey } from '@/i18n';

interface DiscoverProbeResponse {
  ok?: boolean;
  modelCount?: number;
  diff?: { modelId: string; upstreamModelId: string; status: string }[];
  classification?: string;
  error?: { message?: string };
}

interface ApplyStatsResponse {
  inserted: number;
  refreshedPristine: number;
  recommendedEnabled: number;
  discoveredHidden: number;
}

/**
 * Outcome of one provider's discovery cycle. Drives the rolling-summary
 * toast in batch mode and the single-provider toast in interactive mode.
 *
 * - `success`        — apply ran with at least one writeable row
 * - `up-to-date`     — probe ok and upstream returned models, but every
 *                      row was already in the unchanged bucket. We still
 *                      send them through apply so `last_refreshed_at`
 *                      advances and the section's "上次同步" reflects
 *                      this probe.
 * - `no-models`      — probe ok but upstream returned an empty model
 *                      list (legitimate empty state — caller should
 *                      treat as "this provider has nothing to expose")
 * - `unsupported`    — provider type can't be probed (image / OAuth / env)
 * - `probe-failed`   — HTTP/network error reaching upstream model list
 * - `apply-failed`   — probe succeeded, apply route returned non-2xx
 * - `error`          — uncaught exception
 */
export type AutoDiscoverOutcome =
  | 'success'
  | 'up-to-date'
  | 'no-models'
  | 'unsupported'
  | 'probe-failed'
  | 'apply-failed'
  | 'error';

export interface AutoDiscoverResult {
  outcome: AutoDiscoverOutcome;
  /** Total upstream model count (modelCount from probe). */
  total?: number;
  /** Counts from the apply step — only populated when outcome=success. */
  recommendedEnabled?: number;
  discoveredHidden?: number;
  /** Free-form error detail; used for batch error log. */
  errorMessage?: string;
}

interface ProbeArgs {
  providerId: string;
  providerName: string;
}

/**
 * Runs probe + apply, returns the typed result. No toast. No global event.
 *
 * Caller is responsible for surfacing UI (toast / status row) and for
 * dispatching `provider-changed` if the local view should refresh.
 */
export async function probeAndApplyProvider({
  providerId,
  providerName,
}: ProbeArgs): Promise<AutoDiscoverResult> {
  try {
    const probeRes = await fetch(`/api/providers/${providerId}/discover-models`, { method: 'POST' });
    if (!probeRes.ok) {
      return {
        outcome: 'probe-failed',
        errorMessage: `${probeRes.status} ${probeRes.statusText}`,
      };
    }
    const probe = await probeRes.json() as DiscoverProbeResponse;

    if (!probe.ok) {
      if (probe.classification === 'unsupported') {
        return { outcome: 'unsupported' };
      }
      return {
        outcome: 'probe-failed',
        errorMessage: probe.error?.message ?? `${providerName}: probe rejected`,
      };
    }

    // Two upstream-side buckets:
    //   - `applicable`  — diff entries that result in a substantive write
    //                     (new / will-update / preserve-edited / hidden-but-upstream)
    //   - `unchangedUpstream` — rows that already match upstream exactly
    //
    // We send BOTH through apply so `last_refreshed_at` advances even when
    // nothing changed substantively. Without this, a periodic refresh
    // against an unchanged upstream would leave "上次同步" frozen at the
    // earlier probe time, making the user think the refresh never ran.
    const applicable = (probe.diff || []).filter((e) =>
      e.status === 'new'
      || e.status === 'will-update'
      || e.status === 'preserve-edited'
      || e.status === 'hidden-but-upstream',
    );
    const unchangedUpstream = (probe.diff || []).filter((e) => e.status === 'unchanged');
    const applySet = [...applicable, ...unchangedUpstream];

    if (applySet.length === 0) {
      // Truly empty upstream — no entries on either side. Distinct from
      // up-to-date (which has rows, just nothing to write).
      return { outcome: 'no-models', total: probe.modelCount ?? 0 };
    }

    const applyRes = await fetch(`/api/providers/${providerId}/discover-models/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstreamModels: applySet.map((e) => ({ modelId: e.modelId, upstreamModelId: e.upstreamModelId })),
      }),
    });
    if (!applyRes.ok) {
      return {
        outcome: 'apply-failed',
        errorMessage: `${applyRes.status} ${applyRes.statusText}`,
      };
    }
    const stats = await applyRes.json() as ApplyStatsResponse;

    // `applicable.length === 0` means apply only touched unchanged rows
    // — last_refreshed_at advanced but nothing else moved. Surfaces as
    // a distinct outcome so the UI can say "up-to-date" rather than the
    // less-accurate "X enabled / Y hidden" with all-zero counts.
    return {
      outcome: applicable.length === 0 ? 'up-to-date' : 'success',
      total: probe.modelCount ?? applySet.length,
      recommendedEnabled: stats.recommendedEnabled,
      discoveredHidden: stats.discoveredHidden,
    };
  } catch (err) {
    return {
      outcome: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

interface ToastArgs extends ProbeArgs {
  /** Translator from useTranslation(). Caller passes its bound `t`. */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/**
 * Single-provider entry: shows a toast through loading → outcome and
 * dispatches `provider-changed` on success. Returns the result so
 * callers can chain (e.g. trigger a local refetch even when batch
 * mode owns the toast).
 */
export async function runAutoDiscoverForProvider(args: ToastArgs): Promise<AutoDiscoverResult> {
  const { providerId, providerName, t } = args;
  const loadingToastId = showToast({
    type: 'loading',
    message: t('provider.autoDiscover.loading' as TranslationKey, { name: providerName }),
    duration: 0,
  });

  const result = await probeAndApplyProvider({ providerId, providerName });

  switch (result.outcome) {
    case 'success': {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('provider-changed'));
      }
      updateToast(loadingToastId, {
        type: 'success',
        message: t('provider.autoDiscover.success' as TranslationKey, {
          name: providerName,
          total: String(result.total ?? 0),
          enabled: String(result.recommendedEnabled ?? 0),
          hidden: String(result.discoveredHidden ?? 0),
        }),
        duration: 6000,
      });
      break;
    }
    case 'up-to-date': {
      // Refresh succeeded, nothing changed substantively. We still
      // dispatch provider-changed because last_refreshed_at moved and
      // the section's "上次同步" timestamp needs to repaint.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('provider-changed'));
      }
      updateToast(loadingToastId, {
        type: 'success',
        message: t('provider.autoDiscover.upToDate' as TranslationKey, {
          name: providerName,
          total: String(result.total ?? 0),
        }),
        duration: 5000,
      });
      break;
    }
    case 'no-models':
      updateToast(loadingToastId, {
        type: 'info',
        message: t('provider.autoDiscover.noModels' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      break;
    case 'unsupported':
      updateToast(loadingToastId, {
        type: 'warning',
        message: t('provider.autoDiscover.unsupported' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      break;
    case 'apply-failed':
      updateToast(loadingToastId, {
        type: 'warning',
        message: t('provider.autoDiscover.applyFailed' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      break;
    case 'probe-failed':
    case 'error':
    default:
      updateToast(loadingToastId, {
        type: 'warning',
        message: result.errorMessage
          ? `${providerName}: ${result.errorMessage}`
          : t('provider.autoDiscover.probeFailed' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      break;
  }

  return result;
}
