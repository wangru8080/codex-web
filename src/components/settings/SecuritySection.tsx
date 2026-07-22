"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LogOut, Save } from "lucide-react";
import { useRouter } from "next/navigation";

import { FieldRow } from "@/components/patterns/FieldRow";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/hooks/useTranslation";

type SecurityResponse = {
  email: string;
  turnstile: { enabled: boolean; siteKey: string; secretKeyConfigured: boolean };
};

export function SecuritySection() {
  const { t } = useTranslation();
  const router = useRouter();
  const [data, setData] = useState<SecurityResponse>();
  const [enabled, setEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState<"save" | "logout" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const apply = useCallback((response: SecurityResponse) => {
    setData(response);
    setEnabled(response.turnstile.enabled);
    setSiteKey(response.turnstile.siteKey);
    setSecretKey("");
  }, []);

  useEffect(() => {
    fetch("/api/settings/security", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("security.loadFailed"));
        return response.json() as Promise<SecurityResponse>;
      })
      .then(apply)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : t("security.loadFailed")));
  }, [apply, t]);

  async function save() {
    setBusy("save"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/settings/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, siteKey, secretKey }),
      });
      const result = await response.json() as SecurityResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || t("security.saveFailed"));
      apply(result);
      setMessage(t("security.saved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("security.saveFailed"));
    } finally { setBusy(null); }
  }

  async function logout() {
    setBusy("logout"); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(t("security.logoutFailed"));
      router.replace("/login"); router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : t("security.logoutFailed"));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div><h2 className="text-xl font-semibold">{t("settings.security")}</h2></div>
      <SettingsCard title={t("security.sessionTitle")} description={data?.email || t("security.loading")}>
        <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => void logout()} disabled={busy !== null}><LogOut />{t("security.logout")}</Button></div>
      </SettingsCard>
      <SettingsCard title="Cloudflare Turnstile" description={t("security.turnstileDescription")}>
        <FieldRow label={t("security.enable")} description={t("security.enableDescription")}>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!data || busy !== null} aria-label={t("security.enable")} />
        </FieldRow>
        {enabled && (
          <div className="space-y-5 border-t border-border/50 pt-4">
            <div className="space-y-2">
              <label htmlFor="turnstile-site-key" className="text-sm font-medium">{t("security.siteKey")}</label>
              <Input id="turnstile-site-key" value={siteKey} onChange={(e) => setSiteKey(e.target.value)} className="rounded-lg border border-border bg-background font-mono" placeholder="0x4AAAAAAA..." />
              <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{t("security.cloudflareDashboard")}<ExternalLink className="size-3" /></a>
            </div>
            <div className="space-y-2">
              <label htmlFor="turnstile-secret-key" className="text-sm font-medium">{t("security.secretKey")}</label>
              <Input id="turnstile-secret-key" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} className="rounded-lg border border-border bg-background font-mono" placeholder={data?.turnstile.secretKeyConfigured ? t("security.secretConfiguredPlaceholder") : "0x4AAAAAAA..."} />
              <p className="text-xs text-muted-foreground">{data?.turnstile.secretKeyConfigured ? t("security.secretConfiguredHint") : t("security.secretHint")}</p>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {message && <p className="text-sm text-primary" role="status">{message}</p>}
        <div className="flex justify-end"><Button onClick={() => void save()} disabled={!data || busy !== null}><Save />{busy === "save" ? t("security.saving") : t("security.save")}</Button></div>
      </SettingsCard>
    </div>
  );
}
