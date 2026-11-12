"use client";

import { useCallback, useEffect, useState } from "react";

import { SettingsCard } from "@/components/patterns/SettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { useTranslation } from "@/hooks/useTranslation";

type PermissionProfile = "workspace" | "full_access";

type ApiKeyMetadata = {
  id: string;
  name: string;
  prefix: string;
  permissionProfile: PermissionProfile;
  createdAt: string;
  lastUsedAt: string | null;
};

type CreateResponse = {
  key: string;
  metadata: ApiKeyMetadata;
  error?: string;
};

export function ApiKeysSection() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<ApiKeyMetadata[]>([]);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<PermissionProfile>("workspace");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/settings/api-keys", { cache: "no-store" });
      const result = await response.json() as { keys?: ApiKeyMetadata[]; error?: string };
      if (!response.ok || !Array.isArray(result.keys)) {
        throw new Error(result.error || t("apiKeys.loadError"));
      }
      setKeys(result.keys);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("apiKeys.loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setBusy("create");
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, permissionProfile: profile }),
      });
      const result = await response.json() as CreateResponse;
      if (!response.ok) throw new Error(result.error || t("apiKeys.createError"));
      setCreatedKey(result.key);
      setKeys((current) => [result.metadata, ...current]);
      setName("");
      setProfile("workspace");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("apiKeys.createError"));
    } finally {
      setBusy(null);
    }
  }

  async function revokeKey(key: ApiKeyMetadata) {
    if (!window.confirm(t("apiKeys.revokeConfirm"))) return;
    setBusy(key.id);
    setError("");
    try {
      const response = await fetch(`/api/settings/api-keys/${encodeURIComponent(key.id)}`, {
        method: "DELETE",
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || t("apiKeys.revokeError"));
      setKeys((current) => current.filter((candidate) => candidate.id !== key.id));
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : t("apiKeys.revokeError"));
    } finally {
      setBusy(null);
    }
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">{t("apiKeys.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("apiKeys.description")}</p>
      </div>

      {createdKey && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-5 space-y-3" role="status">
          <div>
            <h3 className="text-sm font-medium">{t("apiKeys.createdTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("apiKeys.createdDescription")}</p>
          </div>
          <code className="block select-all break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
            {createdKey}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copyKey()}>
              <CodexWebIcon name="copy" size="sm" aria-hidden />
              {copied ? t("apiKeys.copied") : t("apiKeys.copy")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreatedKey(null); setCopied(false); }}>
              {t("apiKeys.dismiss")}
            </Button>
          </div>
        </div>
      )}

      <SettingsCard title={t("settings.apiKeys")} description={t("apiKeys.securityNote")}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)]">
          <div className="space-y-2">
            <label htmlFor="api-key-name" className="text-sm font-medium">{t("apiKeys.name")}</label>
            <Input
              id="api-key-name"
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("apiKeys.namePlaceholder")}
              disabled={busy !== null || keys.length >= 3}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="api-key-permission" className="text-sm font-medium">{t("apiKeys.permission")}</label>
            <select
              id="api-key-permission"
              value={profile}
              onChange={(event) => setProfile(event.target.value as PermissionProfile)}
              disabled={busy !== null || keys.length >= 3}
              className="h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <option value="workspace">{t("apiKeys.workspace")}</option>
              <option value="full_access">{t("apiKeys.fullAccess")}</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {profile === "full_access" ? t("apiKeys.fullAccessDesc") : t("apiKeys.workspaceDesc")}
        </p>
        {profile === "full_access" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {t("apiKeys.fullAccessWarning")}
          </p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("apiKeys.limit", { count: keys.length })}</p>
          <Button
            onClick={() => void createKey()}
            disabled={busy !== null || keys.length >= 3 || !name.trim()}
            data-testid="create-api-key"
          >
            <CodexWebIcon name="plus" size="sm" aria-hidden />
            {busy === "create" ? t("apiKeys.creating") : t("apiKeys.create")}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title={t("apiKeys.title")} description={keys.length === 0 ? t("apiKeys.empty") : undefined}>
        {keys.length > 0 && (
          <div className="divide-y divide-border/50 rounded-md border border-border/50">
            {keys.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{key.name}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {key.permissionProfile === "full_access" ? t("apiKeys.fullAccess") : t("apiKeys.workspace")}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{key.prefix}…</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("apiKeys.createdAt")}: {formatTime(key.createdAt, t("apiKeys.never"))}
                    {" · "}
                    {t("apiKeys.lastUsed")}: {key.lastUsedAt ? formatTime(key.lastUsedAt, t("apiKeys.never")) : t("apiKeys.never")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void revokeKey(key)}
                >
                  <CodexWebIcon name="delete" size="sm" aria-hidden />
                  {busy === key.id ? t("apiKeys.revoking") : t("apiKeys.revoke")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard title={t("apiKeys.endpointTitle")} description={t("apiKeys.endpointDescription")}>
        <code className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
          POST /v1alpha/sessions
        </code>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <code className="rounded bg-muted px-2 py-1 font-mono text-xs">X-Goog-Api-Key</code>
          <a
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            href="https://developers.google.com/jules/api"
            target="_blank"
            rel="noreferrer"
          >
            {t("apiKeys.docs")}
            <CodexWebIcon name="external" size="sm" aria-hidden />
          </a>
        </div>
      </SettingsCard>
    </div>
  );
}

function formatTime(value: string, fallback: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}
