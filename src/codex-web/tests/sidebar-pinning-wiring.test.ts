import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("左侧栏置顶接线", () => {
  it("使用当前 Web 用户 ID 隔离置顶偏好", () => {
    const panel = readSource("src/components/layout/ChatListPanel.tsx");

    expect(panel).toContain('fetch("/api/auth/me", { cache: "no-store" })');
    expect(panel).toContain("loadPinnedProjects(userId)");
    expect(panel).toContain("loadPinnedSessions(userId)");
    expect(panel).toContain("savePinnedProjects(pinStorageUserId, next)");
    expect(panel).toContain("savePinnedSessions(pinStorageUserId, next)");
    expect(panel).toContain("onTogglePin={pinStorageUserId ? togglePinnedProject : undefined}");
    expect(panel).toContain("onTogglePin={pinStorageUserId ? togglePinnedSession : undefined}");
  });

  it("仅在存在有效置顶内容时渲染可折叠的置顶分组", () => {
    const panel = readSource("src/components/layout/ChatListPanel.tsx");

    expect(panel).toContain("partitionPinnedSidebar(projectGroups, pinnedProjects, pinnedSessions)");
    expect(panel).toContain("sidebarGroups.pinnedSessions.length > 0 || sidebarGroups.pinnedProjects.length > 0");
    expect(panel).toContain("aria-expanded={!pinnedCollapsed}");
    expect(panel).toContain("sidebarGroups.pinnedSessions.map((session) => renderSessionItem(session, true))");
    expect(panel).toContain("sidebarGroups.pinnedProjects.map((group) => renderProjectGroup(group, true))");
  });

  it("项目菜单提供置顶与取消置顶操作", () => {
    const projectHeader = readSource("src/components/layout/ProjectGroupHeader.tsx");

    expect(projectHeader).toContain("onTogglePin(workingDirectory)");
    expect(projectHeader).toContain("chatList.unpinProject");
    expect(projectHeader).toContain("chatList.pinProject");
  });

  it("会话菜单和置顶行快捷按钮共享同一个置顶切换入口", () => {
    const sessionItem = readSource("src/components/layout/SessionListItem.tsx");

    expect(sessionItem).toContain("showPinShortcut && onTogglePin");
    expect(sessionItem).toContain("onTogglePin(session.id)");
    expect(sessionItem).toContain("chatList.unpinConversation");
    expect(sessionItem).toContain("chatList.pinConversation");
  });
});
