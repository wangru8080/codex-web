import { describe, expect, it, vi } from 'vitest';
import {
  createTerminalProcessSession,
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

  it('spawn 完成前缓冲输入，完成后按顺序写入', async () => {
    const spawn = deferred<void>();
    const write = vi.fn(async () => undefined);
    const session = createTerminalProcessSession({
      spawn: () => spawn.promise,
      write,
      resize: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      onError: vi.fn(),
    });

    const started = session.start();
    session.write('echo ');
    session.write('ok\n');
    expect(write).not.toHaveBeenCalled();

    spawn.resolve();
    await started;
    expect(write).toHaveBeenCalledWith('echo ok\n');
  });

  it('dispose 发生在 spawn 完成前时，迟到的进程会立即终止', async () => {
    const spawn = deferred<void>();
    const kill = vi.fn(async () => undefined);
    const session = createTerminalProcessSession({
      spawn: () => spawn.promise,
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      kill,
      onError: vi.fn(),
    });

    const started = session.start();
    await session.dispose();
    expect(kill).not.toHaveBeenCalled();

    spawn.resolve();
    await started;
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('正常运行时 dispose 终止进程，退出后不重复终止', async () => {
    const kill = vi.fn(async () => undefined);
    const session = createTerminalProcessSession({
      spawn: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      kill,
      onError: vi.fn(),
    });

    await session.start();
    await session.dispose();
    expect(kill).toHaveBeenCalledTimes(1);

    const exited = createTerminalProcessSession({
      spawn: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      kill,
      onError: vi.fn(),
    });
    await exited.start();
    exited.exit();
    await exited.dispose();
    expect(kill).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
