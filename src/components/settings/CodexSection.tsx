'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { CodexQuotaWidget } from '@/components/settings/CodexQuotaWidget';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppServerActions, useAppServerState } from '@/codex-web/AppServerProvider';
import type { GetAccountResponse } from '@/codex/protocol/generated/v2/GetAccountResponse';
import type { GetAccountRateLimitsResponse } from '@/codex/protocol/generated/v2/GetAccountRateLimitsResponse';
import type { LoginAccountResponse } from '@/codex/protocol/generated/v2/LoginAccountResponse';
import { isAccountLoginCompletionFor } from '@/codex-web/account-login-adapter';
import { DiagnosticsBridgePanel } from '@/codex-web/DiagnosticsBridgePanel';

type BusyAction = 'refresh' | 'openai' | 'apiKey' | 'logout' | 'cancel' | null;

function accountLabel(accountState: GetAccountResponse | null, isZh: boolean): string {
  if (!accountState) return isZh ? '正在检查登录状态' : 'Checking sign-in status';
  const account = accountState.account;
  if (!account) {
    return accountState.requiresOpenaiAuth
      ? (isZh ? '未登录' : 'Signed out')
      : (isZh ? '当前运行配置无需登录' : 'The current runtime does not require sign-in');
  }
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
      const accountResponse = await refreshAccount();
      if (accountResponse.account?.type === 'chatgpt') {
        setQuota(await readAccountRateLimits());
      } else {
        setQuota(null);
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(null);
    }
  }, [readAccountRateLimits, refreshAccount]);

  useEffect(() => {
    if (state.connection.data === 'connected') void refresh();
  }, [refresh, state.connection.data]);

  useEffect(() => {
    const completion = state.accountLoginCompletion?.data;
    if (!completion || !isAccountLoginCompletionFor(loginStart, completion)) return;
    setLoginStart(null);
    if (!completion.success) {
      if (busy !== 'cancel') {
        setError(completion.error || (isZh ? 'OpenAI 授权未完成' : 'OpenAI authorization did not complete'));
      }
      return;
    }
    void refresh();
  }, [busy, isZh, loginStart, refresh, state.accountLoginCompletion]);

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
    setError(null);
    try {
      await cancelAccountLogin(loginStart.loginId);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
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

  const accountState = state.account?.data ?? null;
  const account = accountState?.account;
  const accountChecked = accountState !== null;
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
            <p className="mt-1 text-xs text-muted-foreground">{accountLabel(accountState, isZh)}</p>
          </div>
          {signedIn && <Button variant="outline" size="sm" disabled={!connected || busy !== null} onClick={() => void logout()}>{isZh ? '退出登录' : 'Sign out'}</Button>}
        </div>

        {signedIn && quota?.rateLimits && <CodexQuotaWidget snapshot={quota.rateLimits} isZh={isZh} />}

        {accountChecked && !signedIn && !loginStart && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-3 rounded-md bg-muted/30 p-4">
              <div className="text-sm font-medium">{isZh ? 'OpenAI 账户授权' : 'OpenAI account authorization'}</div>
              <Button size="sm" disabled={!connected || busy !== null} onClick={() => void startOpenAIAuth()}>{busy === 'openai' ? (isZh ? '启动中...' : 'Starting...') : (isZh ? '开始授权' : 'Start authorization')}</Button>
            </div>
            <div className="space-y-3 rounded-md bg-muted/30 p-4">
              <div className="text-sm font-medium">{isZh ? 'API Key 登录' : 'API key login'}</div>
              <div className="flex gap-2">
                <Input type="password" value={apiKey} disabled={!connected || busy !== null} placeholder={isZh ? '输入 API Key' : 'Enter API key'} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loginWithApiKey(); }} />
                <Button size="sm" disabled={!connected || busy !== null} onClick={() => void loginWithApiKey()}>{isZh ? '登录' : 'Sign in'}</Button>
              </div>
            </div>
          </div>
        )}

        {loginStart?.type === 'chatgpt' && (
          <LoginContinuation url={loginStart.authUrl} isZh={isZh} busy={busy} onCancel={cancelLogin} />
        )}
        {loginStart?.type === 'chatgptDeviceCode' && (
          <div className="space-y-3 rounded-md border border-border/50 bg-background p-4">
            <a className="block break-all text-xs text-primary underline" href={loginStart.verificationUrl} target="_blank" rel="noreferrer">{loginStart.verificationUrl}</a>
            <div className="font-mono text-sm font-semibold tracking-wider">{loginStart.userCode}</div>
            <p className="text-xs text-muted-foreground">{isZh ? '等待 app-server 确认授权结果...' : 'Waiting for the app-server to confirm authorization...'}</p>
            <Button variant="ghost" size="sm" disabled={busy === 'cancel'} onClick={() => void cancelLogin()}>{isZh ? '取消' : 'Cancel'}</Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/50 bg-card p-5">
        <DiagnosticsBridgePanel />
      </section>
    </div>
  );
}

function LoginContinuation({ url, isZh, busy, onCancel }: { url: string; isZh: boolean; busy: BusyAction; onCancel: () => Promise<void> }) {
  return (
    <div className="space-y-3 rounded-md border border-border/50 bg-background p-4">
      <a className="block break-all text-xs text-primary underline" href={url} target="_blank" rel="noreferrer">{url}</a>
      <p className="text-xs text-muted-foreground">{isZh ? '等待 app-server 确认授权结果...' : 'Waiting for the app-server to confirm authorization...'}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" asChild><a href={url} target="_blank" rel="noreferrer">{isZh ? '打开授权页面' : 'Open authorization page'}</a></Button>
        <Button variant="ghost" size="sm" disabled={busy === 'cancel'} onClick={() => void onCancel()}>{isZh ? '取消' : 'Cancel'}</Button>
      </div>
    </div>
  );
}
