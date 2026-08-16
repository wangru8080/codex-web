'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalFrameCommand, TerminalFrameMessage } from './terminal-frame-protocol';

function post(message: TerminalFrameMessage): void {
  window.parent.postMessage(message, window.location.origin);
}

export function TerminalFrame() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.3,
      scrollback: 5000,
      theme: {
        background: '#fbfbfc', foreground: '#25272b', cursor: '#2563a6', cursorAccent: '#ffffff',
        selectionBackground: '#cfe1f7', black: '#30343b', red: '#c9363e', green: '#18794e',
        yellow: '#9a6700', blue: '#2563a6', magenta: '#8e4ec6', cyan: '#0e7490', white: '#d9dde3',
        brightBlack: '#6f7782', brightRed: '#e5484d', brightGreen: '#2f9e6f', brightYellow: '#c58b00',
        brightBlue: '#3b82c4', brightMagenta: '#ab69d5', brightCyan: '#1592ad', brightWhite: '#ffffff',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminal.focus();

    const input = terminal.onData((data) => post({ type: 'terminal-frame/input', data }));
    const resize = terminal.onResize(({ cols, rows }) => post({ type: 'terminal-frame/resize', cols, rows }));
    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fitAddon.fit();
    });
    observer.observe(container);
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const command = event.data as TerminalFrameCommand;
      if (!command || typeof command !== 'object') return;
      if (command.type === 'terminal-frame/output') terminal.write(command.data);
      if (command.type === 'terminal-frame/exit') terminal.writeln(`\r\nProcess exited with code ${command.code}`);
      if (command.type === 'terminal-frame/error') terminal.writeln(`\r\n${command.message}`);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'terminal-frame/ready' });

    return () => {
      window.removeEventListener('message', onMessage);
      observer.disconnect();
      input.dispose();
      resize.dispose();
      terminal.dispose();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
