"use client";

/**
 * Settings → About — application metadata + utility entries.
 *
 * Pulls together pieces that used to be scattered through General:
 *   - Version
 *   - Account info                  (was Account card at bottom of General)
 *   - Platform info                 (new — install channel + OS)
 *
 * Goal: General is now strictly "application behavior"; About is
 * "what version am I running and how do I see my account."
 * The two surfaces stay clean separately.
 */

import { useTranslation } from "@/hooks/useTranslation";
import { useAccountInfo } from "@/hooks/useAccountInfo";
import { useAppServerSelector } from "@/codex-web/AppServerProvider";
import { runtimePlatformLabel } from "@/codex-web/runtime-platform";
import { MonolithIcon } from "@/components/brand/MonolithIcon";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { Button } from "@/components/ui/button";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import type { TranslationKey } from "@/i18n";
import { APP_VERSION } from "@/lib/app-version";

export function AboutSection() {
  const { t } = useTranslation();
  const { accountInfo } = useAccountInfo();
  const platformOs = useAppServerSelector((state) => state.initialize?.data.platformOs);
  const os = runtimePlatformLabel(platformOs);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("settings.about" as TranslationKey)}</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          {t("settings.aboutDesc" as TranslationKey)}
        </p>
      </div>

      {/* Browser build identity with a stable future Web update entry. */}
      <SettingsCard>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MonolithIcon className="h-10 w-10 shrink-0" />
            <div>
              <h3 className="text-sm font-medium">{t("settings.codepilot")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("settings.version", { version: APP_VERSION })}
              </p>
            </div>
          </div>
          <Button disabled size="sm" variant="outline">
            <CodexWebIcon name="refresh" size="sm" aria-hidden />
            {t("settings.checkForUpdates")}
          </Button>
        </div>
      </SettingsCard>

      {/* Platform info — "what build am I running" surfaces here so a
          user filing a bug report can copy the exact line. */}
      <SettingsCard
        title={t("about.platform.title")}
        description={t("about.platform.desc")}
      >
        <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {t("about.platform.os")}
            </span>
            <span className="text-xs text-foreground/85">{os}</span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {t("about.platform.channel")}
            </span>
            <span className="text-xs text-foreground/85">Web</span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {t("about.platform.appVersion")}
            </span>
            <span className="text-xs text-foreground/85">v{APP_VERSION}</span>
          </div>
        </div>
      </SettingsCard>

      {/* Account info — shown only when the underlying provider
          surfaces it. Read-only display; account management itself
          happens inside the provider that owns the credential
          (Anthropic OAuth, ChatGPT Plus OAuth, etc.). */}
      {accountInfo && (
        <SettingsCard title={t("settings.accountInfo" as TranslationKey)}>
          <div className="space-y-1">
            {accountInfo.email && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("settings.email" as TranslationKey)}:
                </span>{" "}
                {accountInfo.email}
              </p>
            )}
            {accountInfo.organization && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("settings.organization" as TranslationKey)}:
                </span>{" "}
                {accountInfo.organization}
              </p>
            )}
            {accountInfo.subscriptionType && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("settings.subscription" as TranslationKey)}:
                </span>{" "}
                {accountInfo.subscriptionType}
              </p>
            )}
          </div>
        </SettingsCard>
      )}

    </div>
  );
}
