"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, LogOut, Save } from "lucide-react";
import { useRouter } from "next/navigation";

import { FieldRow } from "@/components/patterns/FieldRow";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/auth/TurnstileWidget";
import { useTranslation } from "@/hooks/useTranslation";
import { turnstileClientErrorCode } from "@/lib/web-login";

type SecurityResponse = {
  email: string;
  canManageSecurity: boolean;
  rootManaged: boolean;
  turnstile: { enabled: boolean; siteKey: string; secretKeyConfigured: boolean };
  sso?: {
    enabled: boolean;
    providerName: string;
    issuer: string;
    clientId: string;
    clientSecretConfigured: boolean;
    scopes: string;
    allowedEmails: string[];
    allowedDomains: string[];
  };
};

export function SecuritySection() {
  const { t } = useTranslation();
  const router = useRouter();
  const widgetRef = useRef<TurnstileWidgetHandle>(null);
  const [data, setData] = useState<SecurityResponse>();
  const [enabled, setEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");

  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoProviderName, setSsoProviderName] = useState("SSO");
  const [ssoIssuer, setSsoIssuer] = useState("");
  const [ssoClientId, setSsoClientId] = useState("");
  const [ssoClientSecret, setSsoClientSecret] = useState("");
  const [ssoScopes, setSsoScopes] = useState("openid email profile");
  const [ssoAllowedEmails, setSsoAllowedEmails] = useState("");
  const [ssoAllowedDomains, setSsoAllowedDomains] = useState("");
  const [ssoMessage, setSsoMessage] = useState("");
  const [ssoError, setSsoError] = useState("");

  const [busy, setBusy] = useState<"save" | "saveSso" | "logout" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const apply = useCallback((response: SecurityResponse) => {
    setData(response);
    setEnabled(response.turnstile.enabled);
    setSiteKey(response.turnstile.siteKey);
    setSecretKey("");
    setTurnstileToken("");
    setTurnstileError("");
    if (response.sso) {
      setSsoEnabled(response.sso.enabled);
      setSsoProviderName(response.sso.providerName || "SSO");
      setSsoIssuer(response.sso.issuer);
      setSsoClientId(response.sso.clientId);
      setSsoClientSecret("");
      setSsoScopes(response.sso.scopes || "openid email profile");
      setSsoAllowedEmails(response.sso.allowedEmails.join(", "));
      setSsoAllowedDomains(response.sso.allowedDomains.join(", "));
    }
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
        body: JSON.stringify({ enabled, siteKey, secretKey, turnstileToken }),
      });
      const result = await response.json() as SecurityResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || t("security.saveFailed"));
      apply(result);
      setMessage(t("security.saved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("security.saveFailed"));
      if (enabled) {
        setTurnstileToken("");
        widgetRef.current?.reset();
      }
    } finally { setBusy(null); }
  }

  async function saveSso() {
    setBusy("saveSso"); setSsoError(""); setSsoMessage("");
    try {
      const response = await fetch("/api/settings/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sso: {
            enabled: ssoEnabled,
            providerName: ssoProviderName,
            issuer: ssoIssuer,
            clientId: ssoClientId,
            clientSecret: ssoClientSecret,
            scopes: ssoScopes,
            allowedEmails: ssoAllowedEmails,
            allowedDomains: ssoAllowedDomains,
          },
        }),
      });
      const result = await response.json() as SecurityResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || t("security.saveFailed"));
      apply(result);
      setSsoMessage(t("security.ssoSaved"));
    } catch (saveError) {
      setSsoError(saveError instanceof Error ? saveError.message : t("security.saveFailed"));
    } finally { setBusy(null); }
  }

  async function logout() {
    setBusy("logout"); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(t("security.logoutFailed"));
      window.dispatchEvent(new Event("codex-web:logout"));
      router.replace("/login"); router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : t("security.logoutFailed"));
      setBusy(null);
    }
  }

  const redirectUriPreview = typeof window !== "undefined"
    ? `${window.location.origin}/api/auth/sso/callback`
    : "/api/auth/sso/callback";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div><h2 className="text-xl font-semibold">{t("settings.security")}</h2></div>
      <SettingsCard title={t("security.sessionTitle")} description={data?.email || t("security.loading")}>
        <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => void logout()} disabled={busy !== null}><LogOut />{t("security.logout")}</Button></div>
      </SettingsCard>

      <SettingsCard title={t("security.authModeTitle")} description={t("security.authModeDescription")}>
        <FieldRow label={t("security.enableSso")} description={t("security.enableSsoDescription")}>
          <Switch
            checked={ssoEnabled}
            onCheckedChange={setSsoEnabled}
            disabled={!data?.canManageSecurity || busy !== null}
            aria-label={t("security.enableSso")}
          />
        </FieldRow>
        <div className="space-y-5 border-t border-border/50 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="sso-provider-name" className="text-sm font-medium">{t("security.ssoProviderName")}</label>
              <Input
                id="sso-provider-name"
                value={ssoProviderName}
                disabled={!data?.canManageSecurity}
                onChange={(e) => setSsoProviderName(e.target.value)}
                className="rounded-lg border border-border bg-background"
                placeholder="SSO"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="sso-scopes" className="text-sm font-medium">{t("security.ssoScopes")}</label>
              <Input
                id="sso-scopes"
                value={ssoScopes}
                disabled={!data?.canManageSecurity}
                onChange={(e) => setSsoScopes(e.target.value)}
                className="rounded-lg border border-border bg-background font-mono"
                placeholder="openid email profile"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="sso-issuer" className="text-sm font-medium">{t("security.ssoIssuer")}</label>
            <Input
              id="sso-issuer"
              value={ssoIssuer}
              disabled={!data?.canManageSecurity}
              onChange={(e) => setSsoIssuer(e.target.value)}
              className="rounded-lg border border-border bg-background font-mono"
              placeholder="https://idp.example.com"
            />
            <p className="text-xs text-muted-foreground">{t("security.ssoIssuerHint")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="sso-client-id" className="text-sm font-medium">{t("security.ssoClientId")}</label>
              <Input
                id="sso-client-id"
                value={ssoClientId}
                disabled={!data?.canManageSecurity}
                onChange={(e) => setSsoClientId(e.target.value)}
                className="rounded-lg border border-border bg-background font-mono"
                placeholder="Client ID"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="sso-client-secret" className="text-sm font-medium">{t("security.ssoClientSecret")}</label>
              <Input
                id="sso-client-secret"
                type="password"
                value={ssoClientSecret}
                disabled={!data?.canManageSecurity}
                onChange={(e) => setSsoClientSecret(e.target.value)}
                className="rounded-lg border border-border bg-background font-mono"
                placeholder={data?.sso?.clientSecretConfigured ? t("security.secretConfiguredPlaceholder") : "Client Secret"}
              />
              <p className="text-xs text-muted-foreground">
                {data?.sso?.clientSecretConfigured ? t("security.secretConfiguredHint") : t("security.secretHint")}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="sso-allowed-emails" className="text-sm font-medium">{t("security.ssoAllowedEmails")}</label>
              <Input
                id="sso-allowed-emails"
                value={ssoAllowedEmails}
                disabled={!data?.canManageSecurity}
                onChange={(e) => setSsoAllowedEmails(e.target.value)}
                className="rounded-lg border border-border bg-background font-mono"
                placeholder="admin@example.com"
              />
              <p className="text-xs text-muted-foreground">{t("security.ssoAllowedEmailsHint")}</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="sso-allowed-domains" className="text-sm font-medium">{t("security.ssoAllowedDomains")}</label>
              <Input
                id="sso-allowed-domains"
                value={ssoAllowedDomains}
                disabled={!data?.canManageSecurity}
                onChange={(e) => setSsoAllowedDomains(e.target.value)}
                className="rounded-lg border border-border bg-background font-mono"
                placeholder="example.com"
              />
              <p className="text-xs text-muted-foreground">{t("security.ssoAllowedDomainsHint")}</p>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t("security.ssoRedirectUri")}</p>
            <code className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
              {redirectUriPreview}
            </code>
          </div>
        </div>
        {ssoError && <p className="text-sm text-destructive" role="alert">{ssoError}</p>}
        {ssoMessage && <p className="text-sm text-primary" role="status">{ssoMessage}</p>}
        <div className="flex justify-end">
          <Button
            onClick={() => void saveSso()}
            disabled={!data?.canManageSecurity || busy !== null}
            data-testid="save-sso-settings"
          >
            <Save />
            {busy === "saveSso" ? t("security.saving") : t("security.save")}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="Cloudflare Turnstile" description={t("security.turnstileDescription")}>
        <FieldRow label={t("security.enable")} description={t("security.enableDescription")}>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!data?.canManageSecurity || busy !== null} aria-label={t("security.enable")} />
        </FieldRow>
        {enabled && (
          <div className="space-y-5 border-t border-border/50 pt-4">
            <div className="space-y-2">
              <label htmlFor="turnstile-site-key" className="text-sm font-medium">{t("security.siteKey")}</label>
              <Input id="turnstile-site-key" value={siteKey} disabled={!data?.canManageSecurity} onChange={(e) => { setSiteKey(e.target.value); setTurnstileToken(""); setTurnstileError(""); }} className="rounded-lg border border-border bg-background font-mono" placeholder="0x4AAAAAAA..." />
              <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{t("security.cloudflareDashboard")}<ExternalLink className="size-3" /></a>
            </div>
            <div className="space-y-2">
              <label htmlFor="turnstile-secret-key" className="text-sm font-medium">{t("security.secretKey")}</label>
              <Input id="turnstile-secret-key" type="password" value={secretKey} disabled={!data?.canManageSecurity} onChange={(e) => { setSecretKey(e.target.value); setTurnstileToken(""); widgetRef.current?.reset(); }} className="rounded-lg border border-border bg-background font-mono" placeholder={data?.turnstile.secretKeyConfigured ? t("security.secretConfiguredPlaceholder") : "0x4AAAAAAA..."} />
              <p className="text-xs text-muted-foreground">{data?.turnstile.secretKeyConfigured ? t("security.secretConfiguredHint") : t("security.secretHint")}</p>
            </div>
            {siteKey.trim() && data?.canManageSecurity && (
              <TurnstileWidget
                ref={widgetRef}
                siteKey={siteKey.trim()}
                onVerify={(token) => { setTurnstileToken(token); setTurnstileError(""); }}
                onExpire={() => setTurnstileToken("")}
                onError={(errorCode) => {
                  setTurnstileToken("");
                  const safeCode = turnstileClientErrorCode(errorCode);
                  setTurnstileError(safeCode ? t("security.turnstileTestFailedCode", { code: safeCode }) : t("security.turnstileTestFailed"));
                }}
              />
            )}
            {turnstileError && <p className="text-sm text-destructive" role="alert">{turnstileError}</p>}
            {turnstileToken && <p className="text-sm text-primary" role="status">{t("security.turnstileTestPassed")}</p>}
          </div>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {message && <p className="text-sm text-primary" role="status">{message}</p>}
        <div className="flex justify-end"><Button onClick={() => void save()} disabled={!data?.canManageSecurity || busy !== null || (enabled && !turnstileToken)}><Save />{busy === "save" ? t("security.saving") : t("security.save")}</Button></div>
      </SettingsCard>
    </div>
  );
}
