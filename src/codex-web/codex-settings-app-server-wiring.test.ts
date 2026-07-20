import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Codex 设置页 app-server 接线', () => {
  it('设置页只使用 AppServerProvider 状态和 action', () => {
    const section = read('src/components/settings/CodexSection.tsx');
    expect(section).toContain('useAppServerState');
    expect(section).toContain('useAppServerActions');
    for (const url of [
      '/api/codex/account',
      '/api/codex/status',
      '/api/codex/login',
      '/api/codex/rate-limits',
    ]) {
      expect(section).not.toContain(url);
    }
  });

  it('Provider actions 使用 generated 协议方法', () => {
    const provider = read('src/codex-web/AppServerProvider.tsx');
    for (const method of [
      'account/read',
      'account/login/start',
      'account/login/cancel',
      'account/logout',
      'account/rateLimits/read',
    ]) {
      expect(provider).toContain(`client.request("${method}"`);
    }
  });
});
