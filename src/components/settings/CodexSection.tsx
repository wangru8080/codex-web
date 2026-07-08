"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { CodexQuotaWidget } from "@/components/settings/CodexQuotaWidget";
import { useTranslation } from "@/hooks/useTranslation";
import type { CodexLoginStart } from "@/lib/codex/account";
import type {
  CodexAccountState,
  CodexAvailability,
  CodexRateLimitSnapshot,
} from "@/lib/codex/types";

type BusyAction = "refresh" | "openai" | "apiKey" | "logout" | "cancel" | null;

function accountLabel(account: CodexAccountState | null, isZh: boolean): string {
  if (!account || account.kind === "unknown") {
    return isZh ? "正在读取账户状态" : "Reading account state";
  }
  if (account.kind === "logged_out") {
    return isZh ? "未登录" : "Signed out";
  }
  if (account.account.type === "chatgpt") {
    return account.account.email
      ? `${account.account.email}${account.account.planType ? ` · ${account.account.planType}` : ""}`
      : (isZh ? "OpenAI 账户已登录" : "OpenAI account signed in");
  }
  if (account.account.type === "apiKey") {
    return isZh ? "API Key 已登录" : "API key signed in";
  }
  return account.account.type;
}

function availabilityLabel(availability: CodexAvailability | null, isZh: boolean): string {
  if (!availability || availability.kind === "unknown") {
    return isZh ? "正在检测 Codex Runtime" : "Checking Codex Runtime";
  }
  switch (availability.kind) {
    case "ready":
      return isZh
        ? `已就绪 · ${availability.version} · ${availability.codexHome}`
        : `Ready · ${availability.version} · ${availability.codexHome}`;
    case "installed_idle":
      return isZh
        ? `已安装，等待首次启动 · ${availability.binary}`
        : `Installed, waiting for first start · ${availability.binary}`;
    case "not_installed":
      return isZh ? "未找到 codex 命令" : "codex command not found";
    case "too_old":
      return isZh
        ? `版本过旧：${availability.version}，最低需要 ${availability.minimum}`
        : `Too old: ${availability.version}, requires ${availability.minimum}`;
    case "spawn_failed":
      return isZh ? `启动失败：${availability.reason}` : `Spawn failed: ${availability.reason}`;
  }
}

export function CodexSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const [account, setAccount] = useState<CodexAccountState | null>(null);
  const [availability, setAvailability] = useState<CodexAvailability | null>(null);
  const [quota, setQuota] = useState<CodexRateLimitSnapshot | null>(null);
  const [loginStart, setLoginStart] = useState<CodexLoginStart | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<BusyAction>("refresh");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (forceAccountRefresh = false) => {
    setBusy((current) => current ?? "refresh");
    setError(null);
    try {
      const accountPath = forceAccountRefresh ? "/api/codex/account?refresh=1" : "/api/codex/account";
      const [accountRes, statusRes, quotaRes] = await Promise.all([
        fetch(accountPath, { cache: "no-store" }),
        fetch("/api/codex/status", { cache: "no-store" }),
        fetch("/api/codex/rate-limits", { cache: "no-store" }),
      ]);
      const accountJson = accountRes.ok ? await accountRes.json() : null;
      const statusJson = statusRes.ok ? await statusRes.json() : null;
      const quotaJson = quotaRes.ok ? await quotaRes.json() : null;
      if (accountJson?.state) {
        setAccount(accountJson.state as CodexAccountState);
      }
      if (statusJson?.availability) {
        setAvailability(statusJson.availability as CodexAvailability);
      }
      setQuota((quotaJson?.snapshot ?? null) as CodexRateLimitSnapshot | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const startOpenAIAuth = useCallback(async () => {
    setBusy("openai");
    setError(null);
    try {
      const res = await fetch("/api/codex/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "chatgpt" }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setLoginStart((json?.login ?? null) as CodexLoginStart | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const loginWithApiKey = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(isZh ? "请输入 API Key" : "Enter an API key");
      return;
    }
    setBusy("apiKey");
    setError(null);
    try {
      const res = await fetch("/api/codex/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "apiKey", apiKey: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setApiKey("");
      setLoginStart(null);
      await refresh(true);
      window.dispatchEvent(new Event("provider-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [apiKey, isZh, refresh]);

  const completeLogin = useCallback(async () => {
    setLoginStart(null);
    await refresh(true);
    window.dispatchEvent(new Event("provider-changed"));
  }, [refresh]);

  const cancelLogin = useCallback(async () => {
    if (!loginStart || loginStart.type === "apiKey") {
      setLoginStart(null);
      return;
    }
    setBusy("cancel");
    try {
      await fetch(`/api/codex/login?loginId=${encodeURIComponent(loginStart.loginId)}`, { method: "DELETE" });
    } catch {
      // 取消失败不阻塞用户继续刷新账户状态。
    } finally {
      setLoginStart(null);
      setBusy(null);
    }
  }, [loginStart]);

  const logout = useCallback(async () => {
    setBusy("logout");
    setError(null);
    try {
      await fetch("/api/codex/account", { method: "DELETE" });
      setAccount({ kind: "logged_out" });
      setQuota(null);
      window.dispatchEvent(new Event("provider-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const signedIn = account?.kind === "logged_in";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <CodexWebIcon name="runtime" size="lg" className="text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">Codex</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {isZh
            ? "服务器上的 Codex 账户与 Runtime 状态。已配置 CODEX_HOME、config.toml 或 auth.json 时，这里会直接显示为已登录。"
            : "Codex account and runtime status for this server. Existing CODEX_HOME, config.toml, or auth.json credentials are detected automatically."}
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-status-error/30 bg-status-error-muted px-4 py-3 text-sm text-status-error-foreground">
          {error}
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border/50 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Codex Runtime</h3>
            <p className="mt-1 text-xs text-muted-foreground">{availabilityLabel(availability, isZh)}</p>
          </div>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refresh(true)}>
            {isZh ? "刷新" : "Refresh"}
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/50 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{isZh ? "Codex 账户" : "Codex Account"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{accountLabel(account, isZh)}</p>
          </div>
          {signedIn && (
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void logout()}>
              {isZh ? "退出登录" : "Sign out"}
            </Button>
          )}
        </div>

        {signedIn && quota && <CodexQuotaWidget snapshot={quota} isZh={isZh} />}

        {!signedIn && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-3 rounded-md bg-muted/30 p-4">
              <div>
                <div className="text-sm font-medium">{isZh ? "OpenAI 账户授权" : "OpenAI account authorization"}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isZh
                    ? "使用 Codex 原生登录流程，不走旧登录架构。"
                    : "Uses the native Codex login flow, not the legacy OAuth path."}
                </p>
              </div>
              <Button size="sm" disabled={busy !== null} onClick={() => void startOpenAIAuth()}>
                {busy === "openai" ? (isZh ? "启动中..." : "Starting...") : (isZh ? "开始授权" : "Start authorization")}
              </Button>
            </div>

            <div className="space-y-3 rounded-md bg-muted/30 p-4">
              <div>
                <div className="text-sm font-medium">{isZh ? "API Key 登录" : "API key login"}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isZh
                    ? "API Key 交给 Codex 保存，页面不会写入旧 provider 配置。"
                    : "The API key is saved by Codex and is not written into legacy provider settings."}
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  placeholder={isZh ? "输入 API Key" : "Enter API key"}
                  onChange={(event) => setApiKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void loginWithApiKey();
                    }
                  }}
                />
                <Button size="sm" disabled={busy !== null} onClick={() => void loginWithApiKey()}>
                  {busy === "apiKey" ? (isZh ? "登录中..." : "Signing in...") : (isZh ? "登录" : "Sign in")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {loginStart?.type === "chatgpt" && (
          <div className="space-y-3 rounded-md border border-border/50 bg-background p-4">
            <p className="text-sm font-medium">{isZh ? "继续完成 OpenAI 账户授权" : "Continue OpenAI account authorization"}</p>
            <a className="block break-all text-xs text-primary underline" href={loginStart.authUrl} target="_blank" rel="noreferrer">
              {loginStart.authUrl}
            </a>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <a href={loginStart.authUrl} target="_blank" rel="noreferrer">
                  {isZh ? "打开授权页面" : "Open authorization page"}
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => void completeLogin()}>
                {isZh ? "我已完成登录" : "I completed login"}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy === "cancel"} onClick={() => void cancelLogin()}>
                {isZh ? "取消" : "Cancel"}
              </Button>
            </div>
          </div>
        )}

        {loginStart?.type === "chatgptDeviceCode" && (
          <div className="space-y-3 rounded-md border border-border/50 bg-background p-4">
            <p className="text-sm font-medium">{isZh ? "设备码登录" : "Device-code login"}</p>
            <a className="block break-all text-xs text-primary underline" href={loginStart.verificationUrl} target="_blank" rel="noreferrer">
              {loginStart.verificationUrl}
            </a>
            <div className="font-mono text-sm font-semibold tracking-wider">{loginStart.userCode}</div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void completeLogin()}>
                {isZh ? "我已完成登录" : "I completed login"}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy === "cancel"} onClick={() => void cancelLogin()}>
                {isZh ? "取消" : "Cancel"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
