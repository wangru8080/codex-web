"use client";

/**
 * Settings → General — application behavior only.
 *
 * Strictly: language and default panel. The Settings IA Phase 2
 * cleanup moved everything else out:
 *
 *   - UpdateCard / version + update check  → Settings → About
 *   - Account info                          → Settings → About
 *   - Chat history import                   → Settings → About
 *   - Setup Center entry                    → Settings → Overview (system card)
 *                                              + Settings → About (diagnose card)
 *   - Appearance (theme / theme family)    → Settings → Appearance
 *
 * Don't add cross-cutting features here. If a new setting is about
 * "where do I see X status" or "where do I jump to Y management",
 * it belongs on Overview / About / its dedicated section.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import {
  readDefaultPanelPreference,
  writeDefaultPanelPreference,
  type DefaultPanelPreference,
} from "@/lib/app-preferences";

export function GeneralSection() {
  const [defaultPanel, setDefaultPanel] = useState('file_tree');
  const { t, locale, setLocale } = useTranslation();

  useEffect(() => {
    setDefaultPanel(readDefaultPanelPreference());
  }, []);

  const handleDefaultPanelChange = (value: string) => {
    const panel = value as DefaultPanelPreference;
    setDefaultPanel(value);
    writeDefaultPanelPreference(panel);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Page title — matches other Settings sub-pages. */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('settings.general')}</h2>
      </div>
      {/* General settings card */}
      <SettingsCard>
        {/* Default panel */}
        <FieldRow
          label={t('settings.defaultPanelTitle')}
          description={t('settings.defaultPanelDesc')}
          separator
        >
          <Select value={defaultPanel} onValueChange={handleDefaultPanelChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('settings.defaultPanelNone')}</SelectItem>
              <SelectItem value="file_tree">{t('settings.defaultPanelFileTree')}</SelectItem>
              <SelectItem value="git">{t('settings.defaultPanelGit')}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>

        {/* Language picker */}
        <FieldRow
          label={t('settings.language')}
          description={t('settings.languageDesc')}
          separator
        >
          <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

      </SettingsCard>

    </div>
  );
}
