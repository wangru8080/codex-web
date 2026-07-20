import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Codex app-server 单 runtime 边界', () => {
  it('聊天生产入口不再依赖多 runtime 和第三方 Provider', () => {
    const sources = [
      'src/components/chat/ChatView.tsx',
      'src/components/chat/MessageInput.tsx',
      'src/hooks/useProviderModels.ts',
    ].map(read).join('\n');

    for (const legacyImport of [
      /from ['"]@\/hooks\/useGlobalAgentRuntime['"]/,
      /from ['"]@\/lib\/runtime\//,
      /from ['"]@\/lib\/provider-catalog['"]/,
      /fetch\(['"]\/api\/providers\//,
    ]) {
      expect(sources).not.toMatch(legacyImport);
    }
    expect(sources).toContain('useAppServerState');
    expect(sources).toContain('appServerModelsToProviderGroup');
  });

  it('旧 runtime、Provider、Scheduler、Dashboard 和图片生成实现已移出源码树', () => {
    const legacyPaths = [
      'src/lib/claude-code-compat',
      'src/lib/harness',
      'src/lib/claude-client.ts',
      'src/lib/headless-claude.ts',
      'src/lib/provider-resolver.ts',
      'src/lib/provider-catalog.ts',
      'src/lib/ai-provider.ts',
      'src/lib/dashboard-mcp.ts',
      'src/lib/dashboard-store.ts',
      'src/lib/image-generator.ts',
      'src/lib/image-gen-mcp.ts',
      'src/lib/job-executor.ts',
      'src/lib/task-scheduler.ts',
      'src/lib/agent-task-runner.ts',
      'src/lib/runtime/sdk-runtime.ts',
      'src/lib/runtime/native-runtime.ts',
    ];

    for (const path of legacyPaths) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
  });

  it('app-server 浏览器客户端和 reducer 仍保留', () => {
    for (const path of [
      'src/codex-web/AppServerProvider.tsx',
      'src/codex-web/app-server-browser-client.ts',
      'src/codex-web/turn-reducer.ts',
      'src/codex/protocol/generated/v2/Thread.ts',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
  });
});
