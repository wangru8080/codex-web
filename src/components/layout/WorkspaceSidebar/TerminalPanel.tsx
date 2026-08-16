'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { useAppServerActions, useAppServerSelector } from '@/codex-web/AppServerProvider';
import { decodeBase64, encodeBase64, shellCommand, terminalEnvironment } from '@/codex-web/process-terminal';

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { workingDirectory } = usePanel();
  const initialize = useAppServerSelector((state) => state.initialize?.data ?? null);
  const connection = useAppServerSelector((state) => state.connection.data);
  const { spawnProcess, writeProcessStdin, resizeProcessPty, killProcess, subscribeProcess } = useAppServerActions();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !initialize || connection !== 'connected' || !workingDirectory) return;

    const processHandle = `codex-web-terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.3,
      scrollback: 5000,
      theme: {
        background: '#fbfbfc',
        foreground: '#25272b',
        cursor: '#2563a6',
        cursorAccent: '#ffffff',
        selectionBackground: '#cfe1f7',
        black: '#30343b',
        red: '#c9363e',
        green: '#18794e',
        yellow: '#9a6700',
        blue: '#2563a6',
        magenta: '#8e4ec6',
        cyan: '#0e7490',
        white: '#d9dde3',
        brightBlack: '#6f7782',
        brightRed: '#e5484d',
        brightGreen: '#2f9e6f',
        brightYellow: '#c58b00',
        brightBlue: '#3b82c4',
        brightMagenta: '#ab69d5',
        brightCyan: '#1592ad',
        brightWhite: '#ffffff',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminal.focus();

    let disposed = false;
    let spawned = false;
    const unsubscribe = subscribeProcess(processHandle, (notification) => {
      if (notification.method === 'process/outputDelta') {
        terminal.write(decodeBase64(notification.params.deltaBase64));
        return;
      }
      spawned = false;
      if (!disposed && notification.params.exitCode !== 0) {
        terminal.writeln(`\r\n${t('workspaceSidebar.terminal.exited' as TranslationKey, { code: notification.params.exitCode })}`);
      }
    });
    const input = terminal.onData((data) => {
      void writeProcessStdin({ processHandle, deltaBase64: encodeBase64(data) }).catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    });
    const resize = terminal.onResize((size) => {
      if (!spawned) return;
      void resizeProcessPty({ processHandle, size }).catch(() => undefined);
    });
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fitAddon.fit();
    });
    observer.observe(container);

    void spawnProcess({
      command: shellCommand(initialize.platformFamily),
      processHandle,
      cwd: workingDirectory,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      outputBytesCap: null,
      timeoutMs: null,
      env: terminalEnvironment(),
      size: { rows: terminal.rows, cols: terminal.cols },
    }).then(() => {
      spawned = true;
      if (disposed) void killProcess({ processHandle }).catch(() => undefined);
    }).catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      resize.dispose();
      unsubscribe();
      terminal.dispose();
      if (spawned) void killProcess({ processHandle }).catch(() => undefined);
    };
  }, [connection, initialize, killProcess, resizeProcessPty, spawnProcess, subscribeProcess, t, workingDirectory, writeProcessStdin]);

  const unavailable = !workingDirectory
    ? t('workspaceSidebar.terminal.noDirectory' as TranslationKey)
    : connection !== 'connected' || !initialize
      ? t('workspaceSidebar.terminal.connecting' as TranslationKey)
      : null;

  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-white p-3"
      data-source-breadcrumb="app-server.process/spawn"
      data-testid="workspace-terminal"
    >
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
      {(error || unavailable) && (
        <p className="absolute left-3 top-3 m-0 font-mono text-[13px] text-neutral-600">
          {error || unavailable}
        </p>
      )}
    </div>
  );
}
