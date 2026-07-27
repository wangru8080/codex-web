import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Turn 文件变更 UI 接线", () => {
  const chatView = read("src/components/chat/ChatView.tsx");
  const messageInput = read("src/components/chat/MessageInput.tsx");
  const composerChanges = read("src/components/chat/ComposerFileChanges.tsx");
  const summary = read("src/codex-web/file-change-summary.ts");
  const lifecycleHook = read("src/hooks/useTurnFileChangeSummary.ts");
  const provider = read("src/codex-web/AppServerProvider.tsx");

  it("从 app-server Turn 派生摘要并传入输入框", () => {
    expect(chatView).toContain("deriveTurnFileChangeSummary(presentedAppServerTurn ?? null)");
    expect(chatView).toContain("fileChangeSummary={appServerSend ? visibleAppServerFileChangeSummary : null}");
    expect(messageInput).toContain("summary={fileChangeSummary ?? null}");
    expect(messageInput).toContain('data-testid="composer-activity-bar"');
  });

  it("逐文件点击复用右侧 inline-diff 预览", () => {
    expect(composerChanges).toContain("data-testid=\"composer-file-changes\"");
    expect(composerChanges).toContain("kind: 'inline-diff'");
    expect(composerChanges).toContain("diff: file.diff");
    expect(composerChanges).toContain("if (!summary) return null");
  });

  it("文件变更事实不依赖 Git", () => {
    expect(summary).toContain("app-server.item/fileChange/patchUpdated");
    expect(summary).toContain("deriveTurnFileChangeSummary");
    expect(summary).not.toContain("git status");
  });

  it("通过同一 app-server runtime 的只读 Git 状态管理提交生命周期", () => {
    expect(provider).toContain('client.request("command/exec", params)');
    expect(lifecycleHook).toContain('command: ["git", "rev-parse", "--show-toplevel"]');
    expect(lifecycleHook).toContain('command: ["git", "--literal-pathspecs", "status"');
    expect(lifecycleHook).toContain('sandboxPolicy: { type: "readOnly" as const, networkAccess: false }');
    expect(lifecycleHook).toContain('window.addEventListener("git-refresh", refresh)');
    expect(chatView).toContain("const visibleAppServerFileChangeSummary = useTurnFileChangeSummary(");
    expect(chatView).toContain("appServerFileChangeSummary,");
  });
});
