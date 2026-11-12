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

import { useCallback, useState, useEffect } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { StatusBanner } from "@/components/patterns/StatusBanner";
import { useAppServerActions, useAppServerSelector } from "@/codex-web/AppServerProvider";
import {
  BUILT_IN_DEFAULT_PERMISSION_MODES,
  defaultPermissionModeConfigEdits,
  defaultPermissionModeFromConfig,
  type BuiltInDefaultPermissionMode,
} from "@/codex-web/default-permission-mode";
import {
  readDefaultPanelPreference,
  writeDefaultPanelPreference,
  type DefaultPanelPreference,
} from "@/lib/app-preferences";

export function GeneralSection() {
  const [defaultPanel, setDefaultPanel] = useState('file_tree');
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const { t, locale, setLocale } = useTranslation();
  const connection = useAppServerSelector((state) => state.connection.data);
  const config = useAppServerSelector((state) => state.config?.data);
  const appServer = useAppServerActions();

  useEffect(() => {
    setDefaultPanel(readDefaultPanelPreference());
  }, []);

  const handleDefaultPanelChange = (value: string) => {
    const panel = value as DefaultPanelPreference;
    setDefaultPanel(value);
    writeDefaultPanelPreference(panel);
  };

  const defaultPermission = config
    ? defaultPermissionModeFromConfig(config)
    : 'request_approval';

  const handleDefaultPermissionChange = useCallback(async (value: string) => {
    if (!BUILT_IN_DEFAULT_PERMISSION_MODES.includes(value as BuiltInDefaultPermissionMode)) return;
    setPermissionSaving(true);
    setPermissionError(null);
    try {
      await appServer.writeConfigEdits(
        defaultPermissionModeConfigEdits(value as BuiltInDefaultPermissionMode),
      );
    } catch (error) {
      setPermissionError(
        error instanceof Error
          ? error.message
          : t('settings.defaultPermissionsSaveError'),
      );
    } finally {
      setPermissionSaving(false);
    }
  }, [appServer, t]);

  return (
    <div className="max-w-4xl mx-auto space-y-8" data-source-breadcrumb="app-server.config/read">
      {/* Page title — matches other Settings sub-pages. */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('settings.general')}</h2>
      </div>
      {/* General settings card */}
      <SettingsCard>
        {/* Default permissions */}
        <FieldRow
          label={t('settings.defaultPermissionsTitle')}
          description={t('settings.defaultPermissionsDesc')}
        >
          <Select
            value={defaultPermission}
            onValueChange={(value) => void handleDefaultPermissionChange(value)}
            disabled={connection !== 'connected' || !config || permissionSaving}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="request_approval">{t('settings.defaultPermissionsRequestApproval')}</SelectItem>
              <SelectItem value="auto_approval">{t('settings.defaultPermissionsAutoApproval')}</SelectItem>
              <SelectItem value="full_access">{t('settings.defaultPermissionsFullAccess')}</SelectItem>
              {defaultPermission === 'config' && (
                <SelectItem value="config" disabled>{t('settings.defaultPermissionsCustom')}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </FieldRow>
        {defaultPermission === 'full_access' && (
          <StatusBanner variant="warning">
            {t('permission.fullAccessWarning')}
          </StatusBanner>
        )}
        {permissionError && (
          <p className="text-sm text-destructive" role="alert">
            {t('settings.defaultPermissionsSaveError')}: {permissionError}
          </p>
        )}

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
