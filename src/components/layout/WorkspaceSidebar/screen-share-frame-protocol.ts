export type ScreenShareFrameMessage =
  | { type: 'screen-frame/ready' }
  | {
      type: 'screen-frame/status';
      state: 'connecting' | 'connected' | 'disconnected';
      width?: number;
      height?: number;
      code?: number;
      reason?: string;
    }
  | { type: 'screen-frame/error'; message: string };

export type ScreenShareFrameCommand =
  | { type: 'screen-frame/connect'; wsUrl: string }
  | { type: 'screen-frame/takeover'; wsUrl: string }
  | { type: 'screen-frame/disconnect' };

export function isScreenShareFrameMessage(value: unknown): value is ScreenShareFrameMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as {
    type?: unknown;
    state?: unknown;
    width?: unknown;
    height?: unknown;
    code?: unknown;
    reason?: unknown;
    message?: unknown;
  };
  if (message.type === 'screen-frame/ready') return true;
  if (message.type === 'screen-frame/error') return typeof message.message === 'string';
  if (message.type === 'screen-frame/status') {
    if (message.state !== 'connecting' && message.state !== 'connected' && message.state !== 'disconnected') {
      return false;
    }
    if (message.width !== undefined && (!Number.isInteger(message.width) || Number(message.width) <= 0)) {
      return false;
    }
    if (message.height !== undefined && (!Number.isInteger(message.height) || Number(message.height) <= 0)) {
      return false;
    }
    if (message.code !== undefined && !Number.isInteger(message.code)) {
      return false;
    }
    return true;
  }
  return false;
}
