'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { useAppServerActions, useAppServerSelector } from '@/codex-web/AppServerProvider';
import { createTerminalProcessSession, decodeBase64, encodeBase64, shellCommand, terminalEnvironment } from '@/codex-web/process-terminal';
import { isTerminalFrameMessage, type TerminalFrameCommand } from './terminal-frame-protocol';

export function TerminalPanel() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { workingDirectory } = usePanel();
  const initialize = useAppServerSelector((state) => state.initialize?.data ?? null);
  const connection = useAppServerSelector((state) => state.connection.data);
  const { spawnProcess, writeProcessStdin, resizeProcessPty, killProcess, subscribeProcess } = useAppServerActions();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const processHandleRef = useRef<string | null>(null);

  const send = useCallback((command: TerminalFrameCommand) => {
    frameRef.current?.contentWindow?.postMessage(command, window.location.origin);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !initialize || connection !== 'connected' || !workingDirectory) return;
    const processHandle = `codex-web-terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    processHandleRef.current = processHandle;
    const session = createTerminalProcessSession({
      spawn: () => spawnProcess({
        command: shellCommand(initialize.platformFamily), processHandle, cwd: workingDirectory, tty: true,
        streamStdin: true, streamStdoutStderr: true, outputBytesCap: null, timeoutMs: null,
        env: terminalEnvironment(), size: { cols: 80, rows: 24 },
      }),
      write: (data) => writeProcessStdin({ processHandle, deltaBase64: encodeBase64(data) }),
      resize: (cols, rows) => resizeProcessPty({ processHandle, size: { cols, rows } }),
      kill: () => killProcess({ processHandle }),
      onReady: () => setError(null),
      onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
    });
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow || !isTerminalFrameMessage(event.data)) return;
      if (event.data.type === 'terminal-frame/input') {
        session.write(event.data.data);
      } else if (event.data.type === 'terminal-frame/resize') {
        session.resize(event.data.cols, event.data.rows);
      } else if (event.data.type === 'terminal-frame/ready') {
        void session.start();
      }
    };
    const unsubscribe = subscribeProcess(processHandle, (notification) => {
      if (notification.method === 'process/outputDelta') send({ type: 'terminal-frame/output', data: decodeBase64(notification.params.deltaBase64) });
      else { session.exit(); send({ type: 'terminal-frame/exit', code: notification.params.exitCode }); }
    });
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      unsubscribe();
      void session.dispose();
      processHandleRef.current = null;
    };
  }, [connection, initialize, killProcess, resizeProcessPty, send, spawnProcess, subscribeProcess, workingDirectory, writeProcessStdin]);

  const unavailable = !workingDirectory
    ? t('workspaceSidebar.terminal.noDirectory' as TranslationKey)
    : connection !== 'connected' || !initialize
      ? t('workspaceSidebar.terminal.connecting' as TranslationKey)
      : null;

  return <div className="relative h-full min-h-0 w-full overflow-hidden bg-white" data-source-breadcrumb="app-server.process/spawn" data-testid="workspace-terminal">
    <iframe ref={frameRef} title={t('workspaceSidebar.tool.terminal' as TranslationKey)} src="/workspace/terminal" className="h-full w-full border-0" onLoad={() => setError(null)} />
    {(error || unavailable) && <p className="absolute left-3 top-3 m-0 font-mono text-[13px] text-neutral-600">{error || unavailable}</p>}
  </div>;
}
