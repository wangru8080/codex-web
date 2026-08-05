"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { useTranslation } from "@/hooks/useTranslation";
import { useAppServerActions, useAppServerSelector } from "@/codex-web/AppServerProvider";
import { utf8FromBase64, utf8ToBase64 } from "@/codex-web/app-server-files";

function configPath(codexHome: string, platformFamily: string): string {
  const separator = platformFamily === "windows" || codexHome.includes("\\") ? "\\" : "/";
  return `${codexHome.replace(/[\\/]+$/, "")}${separator}config.toml`;
}

export function ConfigSection() {
  const { t } = useTranslation();
  const connection = useAppServerSelector((state) => state.connection.data);
  const initialize = useAppServerSelector((state) => state.initialize?.data);
  const { readFile, writeFile } = useAppServerActions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openEditor = useCallback(async () => {
    setOpen(true);
    setError(null);
    setDraft("");
    if (!initialize?.codexHome || connection !== "connected") {
      setError(t("settings.configReadError"));
      return;
    }
    setLoading(true);
    try {
      const response = await readFile(configPath(initialize.codexHome, initialize.platformFamily));
      setDraft(utf8FromBase64(response.dataBase64));
    } catch {
      // 不存在时允许从空内容创建 config.toml；其它错误仍会提示用户。
      setError(t("settings.configReadError"));
    } finally {
      setLoading(false);
    }
  }, [connection, initialize, readFile, t]);

  const save = useCallback(async () => {
    if (!initialize?.codexHome || connection !== "connected") return;
    setSaving(true);
    setError(null);
    try {
      await writeFile(
        configPath(initialize.codexHome, initialize.platformFamily),
        utf8ToBase64(draft),
      );
      setOpen(false);
    } catch {
      setError(t("settings.configWriteError"));
    } finally {
      setSaving(false);
    }
  }, [connection, draft, initialize, t, writeFile]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("settings.config")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.configDescription")} · {t("settings.configRefreshDescription")}
        </p>
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">{t("settings.configTitle")}</h3>
        <SettingsCard className="flex items-center justify-between gap-6">
          <div className="min-w-0 space-y-1">
            <p className="font-medium">{t("settings.configFile")}</p>
            <p className="text-sm text-muted-foreground">{t("settings.configDescription")}</p>
            <p className="text-sm text-muted-foreground">{t("settings.configRefreshDescription")}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={() => void openEditor()}
            disabled={connection !== "connected" || !initialize?.codexHome}
          >
            {t("settings.configOpen")}
          </Button>
        </SettingsCard>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("settings.configFile")}</DialogTitle>
            <DialogDescription>{t("settings.configRefreshDescription")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={loading || saving}
            aria-label={t("settings.configFile")}
            className="min-h-[420px] resize-y font-mono text-sm"
            placeholder={loading ? t("settings.configLoading") : undefined}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t("settings.configCancel")}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={loading || saving || connection !== "connected"}>
              {t("settings.configSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
