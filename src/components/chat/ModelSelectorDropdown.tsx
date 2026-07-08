'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { CaretDown } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import type { ProviderModelGroup } from '@/types';
import { compatLabel, compatTone } from '@/lib/runtime-compat';
import { findModelOption } from '@/lib/model-option-match';
import type { RuntimeId } from '@/lib/runtime/runtime-id';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
} from '@/components/patterns';

// Recent-models tracking. Persisted to localStorage so the picker can
// surface "刚用过的几个" at the top — an alternative to a global search
// box (per April 2026 user feedback: search adds noise; recent-list
// covers 80% of the "I want to switch back to that one" intent).
const RECENT_MODELS_KEY = 'codepilot:recent-models';
const RECENT_MODELS_DISPLAY = 3;
const RECENT_MODELS_STORED = 8;

interface RecentModelEntry {
  providerId: string;
  modelValue: string;
  ts: number;
}

function readRecentModels(): RecentModelEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_MODELS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is RecentModelEntry =>
      e && typeof e.providerId === 'string' && typeof e.modelValue === 'string' && typeof e.ts === 'number',
    );
  } catch {
    return [];
  }
}

function pushRecentModel(providerId: string, modelValue: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readRecentModels();
    const filtered = existing.filter(e => !(e.providerId === providerId && e.modelValue === modelValue));
    const next: RecentModelEntry[] = [
      { providerId, modelValue, ts: Date.now() },
      ...filtered,
    ].slice(0, RECENT_MODELS_STORED);
    localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

interface ModelOption {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  /** Phase 6 UI收口 P2 (2026-05-14) — per-row runtime compat from
   *  `getModelCompat`. Drives the disabled state for incompatible
   *  rows alongside the tooltip below. Absent on rows that came
   *  from DEFAULT_MODEL_OPTIONS / env synthetic fallbacks; absent
   *  means "treat as universally supported". */
  supportedRuntimes?: string[];
  /** Per-runtime "why is this unavailable" reason. Picker pipes
   *  the entry for the active runtime into the HTML title tooltip. */
  unsupportedReasonByRuntime?: Record<string, string>;
}

interface ModelSelectorDropdownProps {
  currentModelValue: string;
  currentProviderIdValue: string;
  providerGroups: ProviderModelGroup[];
  modelOptions: ModelOption[];
  onModelChange?: (model: string) => void;
  /** Phase 6 P0 (2026-05-15) — `opts.isAuto` lets MessageInput's
   *  auto-correct effect call this same prop without triggering the
   *  manual-pick side effects (clearing pinned-default warnings,
   *  writing localStorage, PATCHing session). Manual clicks here in
   *  the dropdown always omit the flag. */
  onProviderModelChange?: (
    providerId: string,
    model: string,
    opts?: { isAuto?: boolean },
  ) => void;
  /** Global default model value */
  globalDefaultModel?: string;
  /** Global default model's provider ID */
  globalDefaultProvider?: string;
  /** Which runtime the picker feed was filtered against (server-resolved
   *  when caller passed `?runtime=auto`). Surfaced as a small status row
   *  inside the dropdown so users understand why some configured
   *  providers may not appear. Typed off the canonical `RuntimeId`
   *  union so adding a new runtime (Codex etc.) requires no change here. */
  runtimeApplied?: RuntimeId;
  /** Whether the provider/model fetch is still in flight. When true we
   *  show a "loading" label on the trigger instead of an empty button so
   *  the composer doesn't look broken during the brief async window. */
  isLoading?: boolean;
}

export function ModelSelectorDropdown({
  currentModelValue,
  currentProviderIdValue,
  providerGroups,
  modelOptions,
  onModelChange,
  onProviderModelChange,
  globalDefaultModel,
  globalDefaultProvider,
  runtimeApplied,
  isLoading,
}: ModelSelectorDropdownProps) {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  // Recent-model entries that still resolve to a (provider, model) pair
  // present in the current `providerGroups`. Re-read from localStorage
  // each time the menu opens so it reflects the latest selections, but
  // memoised against `providerGroups` so the matching pass only re-runs
  // when the data actually changes.
  const recentMatches = useMemo(() => {
    if (!modelMenuOpen) return [] as Array<{ group: ProviderModelGroup; option: ModelOption }>;
    const recent = readRecentModels();
    if (recent.length === 0) return [];
    const matches: Array<{ group: ProviderModelGroup; option: ModelOption }> = [];
    for (const entry of recent) {
      const group = providerGroups.find(g => g.provider_id === entry.providerId);
      if (!group) continue;
      // Canonical-aware (tech-debt #37): a stored recent entry may carry a
      // canonical id — match by value OR upstreamModelId so it resolves.
      const option = findModelOption(group.models, entry.modelValue);
      if (!option) continue;
      matches.push({ group, option });
      if (matches.length >= RECENT_MODELS_DISPLAY) break;
    }
    return matches;
  }, [modelMenuOpen, providerGroups]);

  // Canonical-aware (tech-debt #37): resolve the saved id to its alias row by
  // value OR upstreamModelId so the trigger label shows the right model.
  const currentModelOption = findModelOption(modelOptions, currentModelValue) || modelOptions[0];

  const isCurrentDefault = !!(
    globalDefaultModel &&
    globalDefaultProvider &&
    currentModelValue === globalDefaultModel &&
    currentProviderIdValue === globalDefaultProvider
  );

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  const handleModelSelect = useCallback((providerId: string, modelValue: string) => {
    onModelChange?.(modelValue);
    onProviderModelChange?.(providerId, modelValue);
    localStorage.setItem('codepilot:last-model', modelValue);
    localStorage.setItem('codepilot:last-provider-id', providerId);
    pushRecentModel(providerId, modelValue);
    setModelMenuOpen(false);
  }, [onModelChange, onProviderModelChange]);

  const showLoading = isLoading || !currentModelOption;

  return (
    <div className="relative" ref={modelMenuRef}>
      <PromptInputButton
        onClick={() => setModelMenuOpen((prev) => !prev)}
        disabled={showLoading}
      >
        {showLoading ? (
          <span className="text-xs text-muted-foreground">
            {t('composer.modelLoading' as TranslationKey)}
          </span>
        ) : (
          <>
            <span className="text-xs font-mono">{currentModelOption?.label}</span>
            {isCurrentDefault && (
              <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">
                {isZh ? '· 默认' : '· Default'}
              </span>
            )}
          </>
        )}
        <CaretDown size={10} className={cn("transition-transform duration-200", modelMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {modelMenuOpen && (
        // Round 12: mount-time animation matches shadcn Select /
        // Radix Popover (`data-[state=open]:animate-in fade-in-0
        // zoom-in-95 slide-in-from-top-2`). The dropdown is custom
        // (built around a controlled `modelMenuOpen` + click-outside,
        // not Radix), so we apply the animate-in directly via
        // tailwindcss-animate utilities on mount. Without these the
        // popover used to pop in instantly while every other dropdown
        // in the app animated — visually inconsistent.
        <CommandList className="w-80 mb-1.5 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-150">
          {/* Phase 6 UI收口 P2 (2026-05-14) — header disclosures removed.
              The previous "only showing models for X" / "Codex currently
              supports only ..." banners explained a server-side filter
              that no longer exists; the picker now renders all models
              and disables (with hover tooltip) the ones incompatible
              with the current engine. The active engine is already
              visible in the composer's bottom toolbar — no need to
              repeat it here. */}
          <CommandListItems className="max-h-80">
            {recentMatches.length > 0 && (
              <CommandListGroup label={t('composer.recentModels' as TranslationKey)}>
                {recentMatches.map(({ group, option }) => {
                  // Canonical-aware active check (tech-debt #37) — resolve the
                  // current id within this group so a canonical id highlights
                  // its alias row instead of nothing.
                  const isActive = group.provider_id === currentProviderIdValue && findModelOption(group.models, currentModelValue)?.value === option.value;
                  // Phase 6 UI收口 P2 (2026-05-14) — recent rows honour
                  // the same runtime gating as the main groups below.
                  // Without this a "recently used GLM" entry could stay
                  // clickable under Codex Runtime even though picking
                  // it would route to a model the active engine can't
                  // serve.
                  const supportsCurrentRuntime =
                    !runtimeApplied
                    || !option.supportedRuntimes
                    || option.supportedRuntimes.includes(runtimeApplied);
                  const incompatTooltip = !supportsCurrentRuntime
                    ? (option.unsupportedReasonByRuntime?.[runtimeApplied!]
                        ?? (isZh
                          ? '当前 Agent 引擎不支持此模型；切换到兼容引擎可启用。'
                          : 'Current Agent engine does not support this model. Switch to a compatible engine to enable.'))
                    : undefined;
                  return (
                    <CommandListItem
                      key={`recent-${group.provider_id}-${option.value}`}
                      active={isActive}
                      disabled={!supportsCurrentRuntime}
                      tooltip={incompatTooltip}
                      onClick={() => handleModelSelect(group.provider_id, option.value)}
                    >
                      <span className="font-mono text-xs truncate">{option.label}</span>
                      <span className="ml-auto text-[10px] font-normal text-muted-foreground truncate max-w-[100px]">
                        {group.provider_name}
                      </span>
                    </CommandListItem>
                  );
                })}
              </CommandListGroup>
            )}
            {providerGroups.map((group, groupIdx) => (
              <CommandListGroup
                key={group.provider_id}
                label={
                  <span className="flex items-center gap-1.5">
                    <span>{group.provider_name}</span>
                    {group.compat && (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-medium',
                          compatTone(group.compat),
                        )}
                      >
                        {compatLabel(group.compat, isZh)}
                      </span>
                    )}
                  </span>
                }
              >
                {group.models.map((opt) => {
                  // Canonical-aware active check (tech-debt #37) — see recent rows above.
                  const isActive = group.provider_id === currentProviderIdValue && findModelOption(group.models, currentModelValue)?.value === opt.value;
                  const isDefault = !!(
                    globalDefaultModel &&
                    globalDefaultProvider &&
                    opt.value === globalDefaultModel &&
                    group.provider_id === globalDefaultProvider
                  );
                  // Phase 6 UI收口 P2 (2026-05-14) — per-row compat gating.
                  // Models that don't advertise support for the active
                  // runtime render disabled, with the upstream reason
                  // surfaced via the native HTML title tooltip. Rows
                  // without a `supportedRuntimes` annotation fall back
                  // to "compatible" (catalog rows without the canonical
                  // contract — DEFAULT_MODEL_OPTIONS fallback, env
                  // synth group during API failures).
                  const supportsCurrentRuntime =
                    !runtimeApplied
                    || !opt.supportedRuntimes
                    || opt.supportedRuntimes.includes(runtimeApplied);
                  const incompatTooltip = !supportsCurrentRuntime
                    ? (opt.unsupportedReasonByRuntime?.[runtimeApplied!]
                        ?? (isZh
                          ? '当前 Agent 引擎不支持此模型；切换到兼容引擎可启用。'
                          : 'Current Agent engine does not support this model. Switch to a compatible engine to enable.'))
                    : undefined;
                  return (
                    <CommandListItem
                      key={`${group.provider_id}-${opt.value}`}
                      active={isActive}
                      disabled={!supportsCurrentRuntime}
                      tooltip={incompatTooltip}
                      onClick={() => handleModelSelect(group.provider_id, opt.value)}
                    >
                      <span className="font-mono text-xs truncate">{opt.label}</span>
                      {isDefault && (
                        <span className="ml-auto text-[10px] font-medium text-muted-foreground">
                          {isZh ? '默认' : 'Default'}
                        </span>
                      )}
                    </CommandListItem>
                  );
                })}
              </CommandListGroup>
            ))}
            {providerGroups.length === 0 && (
              // Phase 6 UI收口 P2 (2026-05-14) — the picker now shows the
              // full catalog and uses per-row disabled state for runtime
              // compat. An empty catalog here means the user has zero
              // providers configured at all (rare); recovery is the
              // Providers page.
              <div className="px-3 py-6 text-center text-xs text-muted-foreground leading-relaxed">
                {isZh
                  ? '尚未配置任何服务商。请前往「设置 → 服务商」添加。'
                  : 'No providers configured yet. Visit Settings → Providers to add one.'}
              </div>
            )}
          </CommandListItems>
        </CommandList>
      )}
    </div>
  );
}
