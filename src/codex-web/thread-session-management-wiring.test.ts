import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("app-server 会话管理接线", () => {
  const provider = readFileSync(resolve(process.cwd(), "src/codex-web/AppServerProvider.tsx"), "utf8");
  const sidebar = readFileSync(resolve(process.cwd(), "src/components/layout/ChatListPanel.tsx"), "utf8");
  const topbar = readFileSync(resolve(process.cwd(), "src/components/layout/UnifiedTopBar.tsx"), "utf8");
  const archived = readFileSync(resolve(process.cwd(), "src/components/settings/ArchivedThreadsSection.tsx"), "utf8");
  const settingsNav = readFileSync(resolve(process.cwd(), "src/components/settings/nav-config.ts"), "utf8");

  it("Provider 使用官方 thread 管理方法", () => {
    expect(provider).toContain('client.request("thread/name/set", params)');
    expect(provider).toContain('client.request("thread/archive", { threadId })');
    expect(provider).toContain('client.request("thread/unarchive", { threadId })');
    expect(provider).toContain('client.request("thread/delete", { threadId })');
  });

  it("左右会话入口不再通过旧 REST 重命名或归档", () => {
    expect(sidebar).toContain("setThreadName({ threadId: sessionId, name: newTitle })");
    expect(sidebar).toContain("archiveThread(sessionId)");
    expect(topbar).toContain("setThreadName({ threadId: sessionId, name: trimmed })");
    expect(topbar).toContain("archiveThread(sessionId)");
    expect(sidebar).not.toContain('method: "PATCH"');
    expect(topbar).not.toContain("method: 'PATCH'");
  });

  it("复制 ID 和分屏动作不触发归档或恢复", () => {
    expect(topbar).toContain("copyWithToast({ text: sessionId, t })");
    expect(topbar).toContain("addToSplit({");
    expect(topbar).not.toContain("unarchiveThread(sessionId)");
  });

  it("归档设置页只从 app-server 读取真实归档 thread", () => {
    expect(settingsNav).toContain('href: "/settings/archived"');
    expect(archived).toContain("archived: true");
    expect(archived).toContain('sortKey: "recency_at"');
    expect(archived).toContain("response.nextCursor");
    expect(archived).not.toContain("/api/chat/sessions");
  });

  it("取消归档与永久删除使用独立 action，且删除受确认对话框保护", () => {
    expect(archived).toContain("runForIds([thread.id], unarchiveThread)");
    expect(archived).toContain("runForIds(ids, deleteThread)");
    expect(archived).toContain("<AlertDialogAction variant=\"destructive\"");
    expect(archived).toContain("if (!deleteTarget) return");
  });
});
