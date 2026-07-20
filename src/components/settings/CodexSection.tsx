'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { CodexQuotaWidget } from '@/components/settings/CodexQuotaWidget';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppServerActions, useAppServerState } from '@/codex-web/AppServerProvider';
import type { Account } from '@/codex/protocol/generated/v2/Account';
import type { GetAccountRateLimitsResponse } from '@/codex/protocol/generated/v2/GetAccountRateLimitsResponse';
import type { LoginAccountResponse } from '@/codex/protocol/generated/v2/LoginAccountResponse';

type BusyAction = 'refresh' | 'openai' | 'apiKey' | 'logout' | 'cancel' | null;

function accountLabel(account: Account | null | undefined, isZh: boolean): string {
  if (!account) return isZh ? '未登录' : 'Signed out';
  if (account.type === 'chatgpt') {
    return account.email
      ? `${account.email}${account.planType ? ` · ${account.planType}` : ''}`
      : (isZh ? 'OpenAI 账户已登录' : 'OpenAI account signed in');
  }
  if (account.type === 'apiKey') return isZh ? 'API Key 已登录' : 'API key signed in';
  return isZh ? 'Amazon Bedrock 已登录' : 'Amazon Bedrock signed in';
}

export function CodexSection() {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';
  const state = useAppServerState();
  const {
    refreshAccount,
    readAccountRateLimits,
    startAccountLogin,
    cancelAccountLogin,
    logoutAccount,
  } = useAppServerActions();
  const [quota, setQuota] = useState<GetAccountRateLimitsResponse | null>(null);
  const [loginStart, setLoginStart] = useState<LoginAccountResponse | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy((current) => current ?? 'refresh');
    setError(null);
    try {
      await refreshAccount();
      setQuota(await readAccountRateLimits());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(null);
    }
  }, [readAccountRateLimits, refreshAccount]);

  useEffect(() => {
    if (state.connection.data === 'connected') void refresh();
  }, [refresh, state.connection.data]);

  const startOpenAIAuth = useCallback(async () => {
    setBusy('openai');
    setError(null);
    try {
      setLoginStart(await startAccountLogin({ type: 'chatgpt' }));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(null);
    }
  }, [startAccountLogin]);

  const loginWithApiKey = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(isZh ? '请输入 API Key' : 'Enter an API key');
      return;
    }
    setBusy('apiKey');
    setError(null);
    try {
      await startAccountLogin({ type: 'apiKey', apiKey: trimmed });
      setApiKey('');
      setLoginStart(null);
      await refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(null);
    }
  }, [apiKey, isZh, refresh, startAccountLogin]);

  const cancelLogin = useCallback(async () => {
    if (!loginStart || loginStart.type === 'apiKey' || loginStart.type === 'chatgptAuthTokens') {
      setLoginStart(null);
      return;
    }
    setBusy('cancel');
    try {
      await cancelAccountLogin(loginStart.loginId);
    } finally {
      setLoginStart(null);
      setBusy(null);
    }
  }, [cancelAccountLogin, loginStart]);

  const logout = useCallback(async () => {
    setBusy('logout');
    setError(null);
    try {
      await logoutAccount();
      setQuota(null);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : String(logoutError));
    } finally {
      setBusy(null);
    }
  }, [logoutAccount]);

  const account = state.account?.data.account;
  const signedIn = !!account;
  const connected = state.connection.data === 'connected';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <CodexWebIcon name="runtime" size="lg" className="text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">Codex</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {isZh ? '当前 Web bridge 连接的 Codex app-server 账户与运行状态。' : 'Account and runtime state from the Codex app-server connected through the Web bridge.'}
        </p>
      </header>

      {error && <div className="rounded-lg border border-status-error/30 bg-status-error-muted px-4 py-3 text-sm text-status-error-foreground">{error}</div>}

      <section className="space-y-3 rounded-lg border border-border/50 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Codex app-server</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {connected ? (isZh ? '已连接' : 'Connected') : (isZh ? '未连接' : 'Disconnected')}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={!connected || busy !== null} onClick={() => void refresh()}>
            {isZh ? '刷新' : 'Refresh'}
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/50 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{isZh ? 'Codex 账户' : 'Codex Account'}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{accountLabel(account, isZh)}</p>
          </div>
          {signedIn && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void logout()}>{isZh ? '退出登录' : 'Sign out'}</Button>}
        </div>

        {signedIn && quota?.rateLimits && <CodexQuotaWidget snapshot={quota.rateLimits} isZh={isZh} />}

        {!signedIn && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-3 rounded-md bg-muted/30 p-4">
              <div className="text-sm font-medium">{isZh ? 'OpenAI 账户授权' : 'OpenAI account authorization'}</div>
              <Button size="sm" disabled={!connected || busy !== null} onClick={() => void startOpenAIAuth()}>{busy === 'openai' ? (isZh ? '启动中...' : 'Starting...') : (isZh ? '开始授权' : 'Start authorization')}</Button>
            </div>
            <div className="space-y-3 rounded-md bg-muted/30 p-4">
              <div className="text-sm font-medium">{isZh ? 'API Key 登录' : 'API key login'}</div>
              <div className="flex gap-2">
                <Input type="password" value={apiKey} placeholder={isZh ? '输入 API Key' : 'Enter API key'} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loginWithApiKey(); }} />
                <Button size="sm" disabled={!connected || busy !== null} onClick={() => void loginWithApiKey()}>{isZh ? '登录' : 'Sign in'}</Button>
              </div>
            </div>
          </div>
        )}

        {loginStart?.type === 'chatgpt' && (
          <LoginContinuation url={loginStart.authUrl} isZh={isZh} busy={busy} onRefresh={refresh} onCancel={cancelLogin} />
        )}
        {loginStart?.type === 'chatgptDeviceCode' && (
          <div className="space-y-3 rounded-md border border-border/50 bg-background p-4">
            <a className="block break-all text-xs text-primary underline" href={loginStart.verificationUrl} target="_blank" rel="noreferrer">{loginStart.verificationUrl}</a>
            <div className="font-mono text-sm font-semibold tracking-wider">{loginStart.userCode}</div>
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void refresh()}>{isZh ? '我已完成登录' : 'I completed login'}</Button><Button variant="ghost" size="sm" disabled={busy === 'cancel'} onClick={() => void cancelLogin()}>{isZh ? '取消' : 'Cancel'}</Button></div>
          </div>
        )}
      </section>
    </div>
  );
}

function LoginContinuation({ url, isZh, busy, onRefresh, onCancel }: { url: string; isZh: boolean; busy: BusyAction; onRefresh: () => Promise<void>; onCancel: () => Promise<void> }) {
  return (
    <div className="space-y-3 rounded-md border border-border/50 bg-background p-4">
      <a className="block break-all text-xs text-primary underline" href={url} target="_blank" rel="noreferrer">{url}</a>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" asChild><a href={url} target="_blank" rel="noreferrer">{isZh ? '打开授权页面' : 'Open authorization page'}</a></Button>
        <Button variant="outline" size="sm" onClick={() => void onRefresh()}>{isZh ? '我已完成登录' : 'I completed login'}</Button>
        <Button variant="ghost" size="sm" disabled={busy === 'cancel'} onClick={() => void onCancel()}>{isZh ? '取消' : 'Cancel'}</Button>
      </div>
    </div>
  );
}
