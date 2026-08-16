import { describe, expect, it } from 'vitest';
import { isTerminalFrameMessage } from './terminal-frame-protocol';

describe('终端 iframe 通信协议', () => {
  it('接受 ready、input 和 resize 消息', () => {
    expect(isTerminalFrameMessage({ type: 'terminal-frame/ready' })).toBe(true);
    expect(isTerminalFrameMessage({ type: 'terminal-frame/input', data: 'ls\n' })).toBe(true);
    expect(isTerminalFrameMessage({ type: 'terminal-frame/resize', cols: 80, rows: 24 })).toBe(true);
  });

  it('拒绝未知消息和非对象值', () => {
    expect(isTerminalFrameMessage({ type: 'terminal-frame/output', data: 'x' })).toBe(false);
    expect(isTerminalFrameMessage(null)).toBe(false);
    expect(isTerminalFrameMessage('terminal-frame/ready')).toBe(false);
  });
});
