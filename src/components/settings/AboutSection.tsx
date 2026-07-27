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

import { useState } from "react";

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
import { copyWithToast } from "@/lib/clipboard";

const UPGRADE_COMMAND = "npm install --global @wangru8080/codex-web@latest";

type UpdateCheckState =
  | { status: "idle" | "checking" | "current" | "failed" }
  | { status: "available"; latestVersion: string; releaseUrl: string };

export function AboutSection() {
  const { t } = useTranslation();
  const { accountInfo } = useAccountInfo();
  const platformOs = useAppServerSelector((state) => state.initialize?.data.platformOs);
  const os = runtimePlatformLabel(platformOs);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({ status: "idle" });

  async function checkForUpdates() {
    setUpdateCheck({ status: "checking" });
    try {
      const response = await fetch("/api/app/updates", { cache: "no-store" });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object") throw new Error("检查更新失败");

      const update = result as Record<string, unknown>;
      if (typeof update.updateAvailable !== "boolean" || typeof update.latestVersion !== "string") {
        throw new Error("更新响应无效");
      }
      if (update.updateAvailable) {
        if (typeof update.releaseUrl !== "string") throw new Error("更新地址无效");
        setUpdateCheck({
          status: "available",
          latestVersion: update.latestVersion,
          releaseUrl: update.releaseUrl,
        });
      } else {
        setUpdateCheck({ status: "current" });
      }
    } catch {
      setUpdateCheck({ status: "failed" });
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("settings.about" as TranslationKey)}</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          {t("settings.aboutDesc" as TranslationKey)}
        </p>
      </div>

      {/* Browser build identity and the user-triggered npm update check. */}
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
          <Button
            aria-busy={updateCheck.status === "checking"}
            disabled={updateCheck.status === "checking"}
            onClick={() => void checkForUpdates()}
            size="sm"
            variant="outline"
          >
            <CodexWebIcon
              name="refresh"
              size="sm"
              className={updateCheck.status === "checking" ? "animate-spin" : undefined}
              aria-hidden
            />
            {updateCheck.status === "checking"
              ? t("settings.checkingForUpdates")
              : t("settings.checkForUpdates")}
          </Button>
        </div>
        {updateCheck.status !== "idle" && updateCheck.status !== "checking" && (
          <div
            className="border-t border-border/50 pt-3 text-xs"
            role="status"
            aria-live="polite"
            data-source="npm.registry/@wangru8080/codex-web/latest"
          >
            {updateCheck.status === "available" ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-foreground/85">
                  {t("about.update.available", { version: updateCheck.latestVersion })}{" "}
                  <a
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    href={updateCheck.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("about.update.viewRelease")}
                    <CodexWebIcon name="external" size={10} aria-hidden />
                  </a>
                </p>
                <Button
                  onClick={() => void copyWithToast({ text: UPGRADE_COMMAND, t })}
                  size="xs"
                  variant="outline"
                >
                  <CodexWebIcon name="copy" size="sm" aria-hidden />
                  {t("about.update.copyCommand")}
                </Button>
              </div>
            ) : (
              <p className={updateCheck.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                {t(updateCheck.status === "failed" ? "about.update.failed" : "about.update.current")}
              </p>
            )}
          </div>
        )}
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
