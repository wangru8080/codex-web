import type { ProcessOutputDeltaNotification } from '@/codex/protocol/generated/v2/ProcessOutputDeltaNotification';
import type { ProcessExitedNotification } from '@/codex/protocol/generated/v2/ProcessExitedNotification';
import type { ProcessTerminalSize } from '@/codex/protocol/generated/v2/ProcessTerminalSize';

export type ProcessSpawnParams = {
  command: string[];
  processHandle: string;
  cwd: string;
  tty: boolean;
  streamStdin: boolean;
  streamStdoutStderr: boolean;
  outputBytesCap: number | null;
  timeoutMs: number | null;
  env?: Record<string, string | null> | null;
  size: ProcessTerminalSize;
};

export type ProcessWriteStdinParams = {
  processHandle: string;
  deltaBase64?: string;
  closeStdin?: boolean;
};

export type ProcessResizePtyParams = {
  processHandle: string;
  size: ProcessTerminalSize;
};

export type ProcessKillParams = { processHandle: string };
export type ProcessNotification =
  | { method: 'process/outputDelta'; params: ProcessOutputDeltaNotification }
  | { method: 'process/exited'; params: ProcessExitedNotification };

export function processNotification(notification: { method: string; params?: unknown }): ProcessNotification | null {
  if (notification.method !== 'process/outputDelta' && notification.method !== 'process/exited') return null;
  const params = notification.params;
  if (!params || typeof params !== 'object' || typeof (params as { processHandle?: unknown }).processHandle !== 'string') {
    return null;
  }
  return { method: notification.method, params } as ProcessNotification;
}

export function encodeBase64(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function shellCommand(platformFamily: string): string[] {
  if (platformFamily.toLowerCase() === 'windows') return ['powershell.exe'];
  return ['/bin/sh', '-lc', 'exec "${SHELL:-/bin/sh}" -i'];
}

export function terminalEnvironment(): Record<string, string> {
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
  };
}

type TerminalProcessSessionActions = {
  spawn: () => Promise<void>;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  kill: () => Promise<void>;
  onReady?: () => void;
  onError: (error: unknown) => void;
};

export type TerminalProcessSession = {
  start: () => Promise<void>;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  exit: () => void;
  dispose: () => Promise<void>;
};

export function createTerminalProcessSession(actions: TerminalProcessSessionActions): TerminalProcessSession {
  let state: 'idle' | 'starting' | 'running' | 'exited' = 'idle';
  let disposed = false;
  let bufferedInput = '';
  let startPromise: Promise<void> | null = null;

  const report = (error: unknown) => {
    if (!disposed) actions.onError(error);
  };
  const kill = async () => {
    try {
      await actions.kill();
    } catch (error) {
      report(error);
    }
  };

  return {
    start() {
      if (startPromise) return startPromise;
      if (disposed || state !== 'idle') return Promise.resolve();
      state = 'starting';
      startPromise = (async () => {
        try {
          await actions.spawn();
          if (disposed) {
            await kill();
            return;
          }
          state = 'running';
          actions.onReady?.();
          const input = bufferedInput;
          bufferedInput = '';
          if (input) await actions.write(input);
        } catch (error) {
          if (!disposed) state = 'exited';
          report(error);
        }
      })();
      return startPromise;
    },
    write(data) {
      if (!disposed && (state === 'idle' || state === 'starting')) {
        bufferedInput += data;
        return;
      }
      if (!disposed && state === 'running') void actions.write(data).catch(report);
    },
    resize(cols, rows) {
      if (!disposed && state === 'running') void actions.resize(cols, rows).catch(() => undefined);
    },
    exit() {
      if (!disposed) state = 'exited';
      bufferedInput = '';
    },
    async dispose() {
      if (disposed) return;
      const shouldKill = state === 'running';
      disposed = true;
      bufferedInput = '';
      if (shouldKill) await kill();
    },
  };
}
