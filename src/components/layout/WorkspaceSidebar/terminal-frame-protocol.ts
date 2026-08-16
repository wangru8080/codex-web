export type TerminalFrameMessage =
  | { type: 'terminal-frame/ready' }
  | { type: 'terminal-frame/input'; data: string }
  | { type: 'terminal-frame/resize'; cols: number; rows: number };

export type TerminalFrameCommand =
  | { type: 'terminal-frame/init'; cwd: string; platformFamily: string }
  | { type: 'terminal-frame/output'; data: string | Uint8Array }
  | { type: 'terminal-frame/exit'; code: number }
  | { type: 'terminal-frame/error'; message: string };

export function isTerminalFrameMessage(value: unknown): value is TerminalFrameMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
  if (message.type === 'terminal-frame/ready') return true;
  if (message.type === 'terminal-frame/input') return typeof message.data === 'string';
  return message.type === 'terminal-frame/resize'
    && Number.isInteger(message.cols) && Number.isInteger(message.rows)
    && Number(message.cols) > 0 && Number(message.rows) > 0;
}
