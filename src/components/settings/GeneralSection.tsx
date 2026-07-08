"use client";

/**
 * Settings → General — application behavior only.
 *
 * Strictly: language, default panel, generative UI, permission default
 * (auto-approve). The Settings IA Phase 2
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

import { useState, useCallback, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslation } from "@/hooks/useTranslation";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { StatusBanner } from "@/components/patterns/StatusBanner";

export function GeneralSection() {
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [showSkipPermWarning, setShowSkipPermWarning] = useState(false);
  const [skipPermSaving, setSkipPermSaving] = useState(false);
  const [generativeUI, setGenerativeUI] = useState(true);
  const [generativeUISaving, setGenerativeUISaving] = useState(false);
  const [defaultPanel, setDefaultPanel] = useState('file_tree');
  const { t, locale, setLocale } = useTranslation();

  const fetchAppSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        const appSettings = data.settings || {};
        setSkipPermissions(appSettings.dangerously_skip_permissions === "true");
        // generative_ui_enabled defaults to true when not set
        setGenerativeUI(appSettings.generative_ui_enabled !== "false");
        // default_panel defaults to 'file_tree' when not set
        setDefaultPanel(appSettings.default_panel || 'file_tree');
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchAppSettings();
  }, [fetchAppSettings]);

  const handleSkipPermToggle = (checked: boolean) => {
    if (checked) {
      setShowSkipPermWarning(true);
    } else {
      saveSkipPermissions(false);
    }
  };

  const saveSkipPermissions = async (enabled: boolean) => {
    setSkipPermSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { dangerously_skip_permissions: enabled ? "true" : "" },
        }),
      });
      if (res.ok) {
        setSkipPermissions(enabled);
      }
    } catch {
      // ignore
    } finally {
      setSkipPermSaving(false);
      setShowSkipPermWarning(false);
    }
  };

  const handleDefaultPanelChange = async (value: string) => {
    setDefaultPanel(value);
    try {
      await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { default_panel: value } }),
      });
    } catch {
      // ignore
    }
  };

  const handleGenerativeUIToggle = async (checked: boolean) => {
    setGenerativeUISaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { generative_ui_enabled: checked ? "" : "false" },
        }),
      });
      if (res.ok) {
        setGenerativeUI(checked);
      }
    } catch {
      // ignore
    } finally {
      setGenerativeUISaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Page title — matches other Settings sub-pages. */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('settings.general')}</h2>
      </div>
      {/* General settings card */}
      <SettingsCard className={skipPermissions ? "border-status-warning-border bg-status-warning-muted" : undefined}>
        {/* Auto-approve toggle */}
        <FieldRow
          label={t('settings.autoApproveTitle')}
          description={t('settings.autoApproveDesc')}
        >
          <Switch
            checked={skipPermissions}
            onCheckedChange={handleSkipPermToggle}
            disabled={skipPermSaving}
          />
        </FieldRow>
        {skipPermissions && (
          <StatusBanner variant="warning">
            <span className="h-2 w-2 shrink-0 rounded-full bg-status-warning inline-block mr-1" />
            {t('settings.autoApproveWarning')}
          </StatusBanner>
        )}

        {/* Generative UI toggle */}
        <FieldRow
          label={t('settings.generativeUITitle')}
          description={t('settings.generativeUIDesc')}
          separator
        >
          <Switch
            checked={generativeUI}
            onCheckedChange={handleGenerativeUIToggle}
            disabled={generativeUISaving}
          />
        </FieldRow>

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
              <SelectItem value="dashboard">{t('settings.defaultPanelDashboard')}</SelectItem>
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

      {/* Skip-permissions warning dialog */}
      <AlertDialog open={showSkipPermWarning} onOpenChange={setShowSkipPermWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.autoApproveDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {t('settings.autoApproveDialogDesc')}
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('settings.autoApproveShellCommands')}</li>
                  <li>{t('settings.autoApproveFileOps')}</li>
                  <li>{t('settings.autoApproveNetwork')}</li>
                </ul>
                <p className="font-medium text-status-warning-foreground">
                  {t('settings.autoApproveTrustWarning')}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => saveSkipPermissions(true)}
              className="bg-status-warning hover:bg-status-warning/80 text-white"
            >
              {t('settings.enableAutoApprove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
