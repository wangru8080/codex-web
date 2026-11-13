'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { resolveCodexBridgeUrl } from '@/codex-web/bridge-url-runtime';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { ArrowSquareOut } from '@/components/ui/icon';
import type { ScreenShareCapability } from '../../../../server/screen-share/types';
import {
  isScreenShareFrameMessage,
  type ScreenShareFrameCommand,
} from './screen-share-frame-protocol';
import { buildScreenShareWsUrl } from './screen-share-url';

export function ScreenSharePanel() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { t } = useTranslation();
  const [capability, setCapability] = useState<ScreenShareCapability | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);
  const wsUrlRef = useRef<string | null>(null);
  const frameReadyRef = useRef(false);

  const send = useCallback((command: ScreenShareFrameCommand) => {
    frameRef.current?.contentWindow?.postMessage(command, window.location.origin);
  }, []);

  const startConnection = useCallback((wsUrl: string) => {
    setConnectionState('connecting');
    setError(null);
    setDisconnectReason(null);
    send({ type: 'screen-frame/connect', wsUrl });
  }, [send]);

  const loadCapability = useCallback(async () => {
    try {
      const res = await fetch('/api/codex/screen-share', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Capability check failed with status ${res.status}`);
      }
      const data = (await res.json()) as { capability: ScreenShareCapability };
      setCapability(data.capability);
      setCapabilityLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCapabilityLoading(false);
    }
  }, []);

  // Fetch capability
  useEffect(() => {
    void loadCapability();
  }, [loadCapability]);

  // Setup WS URL once available
  useEffect(() => {
    if (capability?.status !== 'available') return;
    let cancelled = false;

    async function loadWsUrl() {
      try {
        const bridgeUrl = await resolveCodexBridgeUrl('');
        if (!cancelled) {
          const wsUrl = buildScreenShareWsUrl(bridgeUrl);
          wsUrlRef.current = wsUrl;
          if (frameReadyRef.current) {
            startConnection(wsUrl);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setDisconnectReason(msg);
          setConnectionState('disconnected');
        }
      }
    }

    void loadWsUrl();
    return () => {
      cancelled = true;
    };
  }, [capability, startConnection]);

  // Handle frame messages
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const frame = frameRef.current;
      if (
        !frame
        || event.origin !== window.location.origin
        || event.source !== frame.contentWindow
        || !isScreenShareFrameMessage(event.data)
      ) {
        return;
      }

      const msg = event.data;
      if (msg.type === 'screen-frame/ready') {
        frameReadyRef.current = true;
        if (wsUrlRef.current) {
          startConnection(wsUrlRef.current);
        }
      } else if (msg.type === 'screen-frame/status') {
        setConnectionState(msg.state);
        if (msg.width && msg.height) {
          setResolution({ width: msg.width, height: msg.height });
        }
        if (msg.state === 'disconnected') {
          setDisconnectReason(msg.reason ?? null);
        } else {
          setDisconnectReason(null);
          setError(null);
        }
      } else if (msg.type === 'screen-frame/error') {
        setError(msg.message);
        setDisconnectReason(msg.message);
        setConnectionState('disconnected');
      }
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      send({ type: 'screen-frame/disconnect' });
    };
  }, [send, startConnection]);

  const handleTakeover = useCallback(() => {
    if (!wsUrlRef.current) return;
    setError(null);
    setDisconnectReason(null);
    setConnectionState('connecting');
    const takeoverUrl = buildScreenShareWsUrl(wsUrlRef.current, true);
    send({ type: 'screen-frame/takeover', wsUrl: takeoverUrl });
  }, [send]);

  const handleReconnect = useCallback(() => {
    if (!wsUrlRef.current) {
      setError(null);
      setCapabilityLoading(true);
      void loadCapability();
      return;
    }
    setError(null);
    setDisconnectReason(null);
    setConnectionState('connecting');
    send({ type: 'screen-frame/connect', wsUrl: wsUrlRef.current });
  }, [send, loadCapability]);

  const handlePopOut = useCallback(() => {
    window.open('/workspace/screen', '_blank', 'width=1280,height=800,menubar=no,toolbar=no');
  }, []);

  if (capabilityLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white p-4 text-xs text-neutral-500">
        {t('workspaceSidebar.screenShare.connecting' as TranslationKey)}
      </div>
    );
  }

  if (error && !capability) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-white p-6 text-center text-sm text-neutral-600">
        <p className="font-mono text-xs text-red-600 break-words max-w-sm">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setCapabilityLoading(true);
            void loadCapability();
          }}
          className="mt-3 rounded bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-300"
        >
          {t('workspaceSidebar.screenShare.retry' as TranslationKey)}
        </button>
      </div>
    );
  }

  if (capability?.status === 'disabled') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white p-6 text-center text-sm text-neutral-600">
        {t('workspaceSidebar.screenShare.disabled' as TranslationKey)}
      </div>
    );
  }

  if (capability?.status === 'unsupported') {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center bg-white p-6 text-center text-sm text-neutral-600"
        data-source-breadcrumb="bridge.screen-share/probe"
      >
        <p className="text-sm font-medium text-neutral-800 mb-2">
          {t('workspaceSidebar.screenShare.unsupported' as TranslationKey)}
        </p>
        <p className="font-mono text-xs text-red-600 break-words max-w-sm">{capability.reason}</p>
      </div>
    );
  }

  const isAlreadyActive = disconnectReason === 'already-active' || disconnectReason?.includes('4002');
  const isTakenOver = disconnectReason === 'taken-over' || disconnectReason?.includes('4001');

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-neutral-900"
      data-testid="workspace-screen-share"
    >
      {/* Status Bar */}
      <div
        className="flex h-7 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-400"
        data-source-breadcrumb="bridge.screen-share/rfb-serverinit"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              connectionState === 'connected'
                ? 'bg-emerald-500'
                : connectionState === 'connecting'
                  ? 'bg-amber-500'
                  : 'bg-neutral-600'
            }`}
          />
          <span className="truncate max-w-[260px]" title={disconnectReason || undefined}>
            {connectionState === 'connected'
              ? resolution
                ? `${resolution.width} × ${resolution.height}`
                : t('workspaceSidebar.screenShare.connected' as TranslationKey)
              : connectionState === 'connecting'
                ? t('workspaceSidebar.screenShare.connecting' as TranslationKey)
                : disconnectReason
                  ? `${t('workspaceSidebar.screenShare.disconnected' as TranslationKey)}: ${disconnectReason}`
                  : t('workspaceSidebar.screenShare.disconnected' as TranslationKey)}
          </span>
        </div>

        <button
          type="button"
          onClick={handlePopOut}
          title={t('workspaceSidebar.screenShare.popOut' as TranslationKey)}
          className="flex shrink-0 items-center gap-1 text-neutral-400 hover:text-white"
        >
          <ArrowSquareOut size={13} />
          <span>{t('workspaceSidebar.screenShare.popOut' as TranslationKey)}</span>
        </button>
      </div>

      {/* Frame Canvas */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        <iframe
          ref={frameRef}
          title={t('workspaceSidebar.tool.screenShare' as TranslationKey)}
          src="/workspace/screen"
          className="h-full w-full border-0"
        />

        {/* Overlay notices */}
        {(connectionState === 'disconnected' || error || isAlreadyActive || isTakenOver) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/90 p-6 text-center text-white">
            {isAlreadyActive ? (
              <div className="max-w-xs space-y-3">
                <p className="text-sm font-medium">
                  {t('workspaceSidebar.screenShare.alreadyActive' as TranslationKey)}
                </p>
                {disconnectReason && (
                  <p className="font-mono text-xs text-neutral-400 break-words">
                    {disconnectReason}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleTakeover}
                  className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                >
                  {t('workspaceSidebar.screenShare.takeover' as TranslationKey)}
                </button>
              </div>
            ) : isTakenOver ? (
              <div className="max-w-xs space-y-3">
                <p className="text-sm font-medium">
                  {t('workspaceSidebar.screenShare.takenOver' as TranslationKey)}
                </p>
                {disconnectReason && (
                  <p className="font-mono text-xs text-neutral-400 break-words">
                    {disconnectReason}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="rounded bg-neutral-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-600"
                >
                  {t('workspaceSidebar.screenShare.reconnect' as TranslationKey)}
                </button>
              </div>
            ) : (
              <div className="max-w-sm space-y-3">
                <p className="text-sm font-medium text-neutral-200">
                  {t('workspaceSidebar.screenShare.disconnected' as TranslationKey)}
                </p>
                {(error || disconnectReason) && (
                  <div className="rounded border border-red-900/60 bg-red-950/30 p-2 text-left">
                    <p className="font-mono text-xs text-red-400 break-words">
                      {error || disconnectReason}
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="rounded bg-neutral-800 border border-neutral-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                >
                  {t('workspaceSidebar.screenShare.reconnect' as TranslationKey)}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
