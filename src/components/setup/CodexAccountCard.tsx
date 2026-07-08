'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SetupCard } from './SetupCard';
import { useTranslation } from '@/hooks/useTranslation';
import type { SetupCardStatus } from '@/types';
import type { CodexAccountState } from '@/lib/codex/types';

interface CodexAccountCardProps {
  status: SetupCardStatus;
  onStatusChange: (status: SetupCardStatus) => void;
  onBeforeNavigate?: () => Promise<void> | void;
}

function describeAccount(state: CodexAccountState | null, isZh: boolean): string {
  if (!state) return isZh ? '正在读取 Codex 账户状态' : 'Reading Codex account status';
  if (state.kind === 'unknown') {
    return isZh
      ? '暂时无法确认账户状态。若服务器已有 CODEX_HOME、config.toml 或 auth.json，稍后刷新即可。'
      : 'Unable to confirm account state yet. If CODEX_HOME, config.toml, or auth.json already exists on the server, refresh shortly.';
  }
  if (state.kind === 'logged_out') {
    return isZh
      ? '可使用 OpenAI 账户授权、API Key，或服务器已有的 CODEX_HOME 凭据。'
      : 'Use OpenAI account authorization, an API key, or existing CODEX_HOME credentials on the server.';
  }
  if (state.account.type === 'chatgpt') {
    return `${state.account.email} · ${state.account.planType}`;
  }
  return state.account.type === 'apiKey'
    ? (isZh ? '已通过 API Key 登录' : 'Signed in with API key')
    : state.account.type;
}

export function CodexAccountCard({ status, onStatusChange, onBeforeNavigate }: CodexAccountCardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const isZh = t('nav.chats') === '对话';
  const [account, setAccount] = useState<CodexAccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginMessage, setLoginMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/codex/account', { cache: 'no-store' });
      const json = res.ok ? await res.json() : null;
      const state = (json?.state ?? { kind: 'unknown' }) as CodexAccountState;
      setAccount(state);
      onStatusChange(state.kind === 'logged_in' ? 'completed' : 'not-configured');
    } catch {
      setAccount({ kind: 'unknown' });
      onStatusChange('not-configured');
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleStartOAuth = useCallback(async () => {
    setLoginMessage('');
    try {
      const res = await fetch('/api/codex/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'chatgpt' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const login = json?.login;
      if (login?.type === 'chatgpt' && login.authUrl) {
        window.open(login.authUrl, '_blank', 'noopener,noreferrer');
        setLoginMessage(isZh ? '已打开 OpenAI 授权页，授权完成后请刷新状态。' : 'Opened the OpenAI authorization page. Refresh after authorization completes.');
      } else {
        setLoginMessage(isZh ? '登录流程已启动，请稍后刷新状态。' : 'Login started. Refresh shortly.');
      }
    } catch (err) {
      setLoginMessage(err instanceof Error ? err.message : String(err));
    }
  }, [isZh]);

  const handleOpenSettings = useCallback(async () => {
    await onBeforeNavigate?.();
    router.push('/settings/codex');
  }, [onBeforeNavigate, router]);

  const description = status === 'completed'
    ? (isZh ? 'Codex 账户已就绪。' : 'Codex account is ready.')
    : t('setup.codex.description');

  return (
    <SetupCard
      title={t('setup.codex.title')}
      description={description}
      status={status}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {loading ? t('setup.codex.loading') : describeAccount(account, isZh)}
        </p>
        {loginMessage && (
          <p className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            {loginMessage}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="text-xs" onClick={refresh}>
            {t('setup.codex.refresh')}
          </Button>
          {status !== 'completed' && (
            <Button size="sm" className="text-xs" onClick={handleStartOAuth}>
              {t('setup.codex.startOAuth')}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-xs" onClick={handleOpenSettings}>
            {t('setup.codex.openSettings')}
          </Button>
        </div>
      </div>
    </SetupCard>
  );
}
