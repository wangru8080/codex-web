"use client";

import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { ProviderOptions } from "@/types";

interface ProviderOptionsSectionProps {
  providerId: string;
  /** Show thinking mode + 1M context options (only for Anthropic-compatible providers) */
  showThinkingOptions?: boolean;
}

/**
 * Per-provider options: thinking mode + 1M context toggle.
 * Only rendered when `showThinkingOptions` is true.
 */
export function ProviderOptionsSection({ providerId, showThinkingOptions = false }: ProviderOptionsSectionProps) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ProviderOptions>({
    thinking_mode: 'adaptive',
    context_1m: false,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/providers/options?providerId=${encodeURIComponent(providerId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data) setOptions(data.options || {});
        if (!cancelled) setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [providerId]);

  const saveOption = async (key: keyof ProviderOptions, value: string | boolean) => {
    const updated = { ...options, [key]: value };
    setOptions(updated);
    try {
      await fetch('/api/providers/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, options: { [key]: value } }),
      });
    } catch { /* ignore */ }
  };

  if (!loaded || !showThinkingOptions) return null;

  return (
    <div className="ml-[34px] mt-2 space-y-2.5">
      {/* Thinking mode */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground/80">
            {t('settings.thinkingMode' as TranslationKey)}
          </p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {t('settings.thinkingModeDesc' as TranslationKey)}
          </p>
        </div>
        <Select
          value={options.thinking_mode || 'adaptive'}
          onValueChange={(v) => saveOption('thinking_mode', v)}
        >
          <SelectTrigger className="w-[110px] h-7 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="adaptive">{t('settings.thinkingAdaptive' as TranslationKey)}</SelectItem>
            <SelectItem value="enabled">{t('settings.thinkingEnabled' as TranslationKey)}</SelectItem>
            <SelectItem value="disabled">{t('settings.thinkingDisabled' as TranslationKey)}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 1M context */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground/80">
            {t('provider.context1m' as TranslationKey)}
          </p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {t('provider.context1mDesc' as TranslationKey)}
          </p>
        </div>
        <Switch
          checked={options.context_1m || false}
          onCheckedChange={(checked) => saveOption('context_1m', checked)}
          className="scale-[0.85]"
        />
      </div>
    </div>
  );
}
