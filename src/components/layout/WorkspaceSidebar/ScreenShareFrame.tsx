'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveCodexBridgeUrl } from '@/codex-web/bridge-url-runtime';
import type { ScreenShareCapability } from '../../../../server/screen-share/types';
import type { ScreenShareFrameCommand, ScreenShareFrameMessage } from './screen-share-frame-protocol';
import { buildScreenShareWsUrl } from './screen-share-url';

export function ScreenShareFrame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [standaloneError, setStandaloneError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const embedded = window.parent !== window;
    let rfbInstance: any = null;
    let disconnected = false;

    const post = (message: ScreenShareFrameMessage) => {
      if (embedded) {
        window.parent.postMessage(message, window.location.origin);
      }
    };

    const connect = async (wsUrl: string) => {
      if (rfbInstance) {
        try {
          rfbInstance.disconnect();
        } catch {
          // ignore
        }
        rfbInstance = null;
      }

      post({ type: 'screen-frame/status', state: 'connecting' });

      try {
        const { default: RFB } = await import('@novnc/novnc');
        if (disconnected || !containerRef.current) return;

        const rfb = new (RFB as any)(container, wsUrl, {
          shared: true,
          credentials: { password: '' },
        });

        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.viewOnly = false;
        rfb.clipViewport = false;

        let lastCloseCode: number | undefined;
        let lastCloseReason: string | undefined;

        if (typeof (rfb as any)._socketClose === 'function') {
          const originalSocketClose = (rfb as any)._socketClose.bind(rfb);
          (rfb as any)._socketClose = (e: any) => {
            lastCloseCode = e?.code;
            lastCloseReason = e?.reason;
            originalSocketClose(e);
          };
        }

        rfb.addEventListener('connect', () => {
          if (!disconnected) setStandaloneError(null);
          post({
            type: 'screen-frame/status',
            state: 'connected',
            width: rfb._fbWidth,
            height: rfb._fbHeight,
          });
        });

        rfb.addEventListener('disconnect', (e: any) => {
          let reason = lastCloseReason;
          if (!reason) {
            if (lastCloseCode === 4001) reason = 'taken-over';
            else if (lastCloseCode === 4002) reason = 'already-active';
            else if (lastCloseCode === 4003) reason = 'VNC server launch failed';
            else if (lastCloseCode === 1006) reason = 'Connection closed unexpectedly (server unreachable or rejected)';
            else if (lastCloseCode) reason = `Disconnected (code: ${lastCloseCode})`;
            else if (e.detail?.clean) reason = 'Clean disconnect';
            else reason = 'Connection closed';
          }
          if (!embedded && !disconnected) setStandaloneError(reason);
          post({
            type: 'screen-frame/status',
            state: 'disconnected',
            code: lastCloseCode,
            reason,
          });
        });

        rfb.addEventListener('securityfailure', (e: any) => {
          const message = e.detail?.reason || e.detail?.status || 'Security handshake failure';
          if (!embedded && !disconnected) setStandaloneError(message);
          post({
            type: 'screen-frame/error',
            message,
          });
        });

        rfb.addEventListener('capabilities', () => {
          if (!disconnected) setStandaloneError(null);
          post({
            type: 'screen-frame/status',
            state: 'connected',
            width: rfb._fbWidth,
            height: rfb._fbHeight,
          });
        });

        rfbInstance = rfb;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!embedded && !disconnected) setStandaloneError(message);
        post({
          type: 'screen-frame/error',
          message,
        });
      }
    };

    const connectStandalone = async () => {
      try {
        const response = await fetch('/api/codex/screen-share', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Capability check failed with status ${response.status}`);
        }
        const data = (await response.json()) as { capability: ScreenShareCapability };
        if (data.capability.status !== 'available') {
          throw new Error(
            data.capability.status === 'disabled'
              ? 'Screen share is disabled on server.'
              : data.capability.reason,
          );
        }
        const bridgeUrl = await resolveCodexBridgeUrl('');
        if (!disconnected) {
          await connect(buildScreenShareWsUrl(bridgeUrl, true));
        }
      } catch (err) {
        if (!disconnected) {
          setStandaloneError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const command = event.data as ScreenShareFrameCommand;
      if (!command || typeof command !== 'object') return;

      if (command.type === 'screen-frame/connect' || command.type === 'screen-frame/takeover') {
        void connect(command.wsUrl);
      } else if (command.type === 'screen-frame/disconnect') {
        try {
          rfbInstance?.disconnect();
        } catch {
          // ignore
        }
      }
    };

    if (embedded) {
      window.addEventListener('message', onMessage);
      post({ type: 'screen-frame/ready' });
    } else {
      void connectStandalone();
    }

    return () => {
      disconnected = true;
      window.removeEventListener('message', onMessage);
      if (rfbInstance) {
        try {
          rfbInstance.disconnect();
        } catch {
          // ignore
        }
        rfbInstance = null;
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-900">
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center"
        style={{ userSelect: 'none' }}
      />
      {standaloneError && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/85 p-6 text-center">
          <p className="max-w-md break-words font-mono text-xs text-red-400">{standaloneError}</p>
        </div>
      )}
    </div>
  );
}
