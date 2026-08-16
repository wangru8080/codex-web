import { describe, expect, it } from 'vitest';
import {
  decodeBase64,
  encodeBase64,
  processNotification,
  shellCommand,
  terminalEnvironment,
} from '@/codex-web/process-terminal';

describe('终端 process 协议适配', () => {
  it('编码和解码 stdin/output 字节', () => {
    const encoded = encodeBase64('pwd\n');
    expect(new TextDecoder().decode(decodeBase64(encoded))).toBe('pwd\n');
  });

  it('只接受带 processHandle 的 process notification', () => {
    expect(processNotification({ method: 'process/outputDelta', params: { processHandle: 'terminal-1' } })).toMatchObject({
      method: 'process/outputDelta',
    });
    expect(processNotification({ method: 'process/outputDelta', params: {} })).toBeNull();
    expect(processNotification({ method: 'thread/started', params: {} })).toBeNull();
  });

  it('按目标平台选择交互 shell', () => {
    expect(shellCommand('unix')).toEqual(['/bin/sh', '-lc', 'exec "${SHELL:-/bin/sh}" -i']);
    expect(shellCommand('windows')).toEqual(['powershell.exe']);
  });

  it('为 PTY 声明 ANSI 256 色和真彩色能力', () => {
    expect(terminalEnvironment()).toEqual({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      CLICOLOR: '1',
    });
  });
});
