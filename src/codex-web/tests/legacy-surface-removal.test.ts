import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("遗留产品入口移除", () => {
  it("设置页不再暴露旧定时任务中心", () => {
    const nav = source("src/components/settings/nav-config.ts");
    const settingsRoot = source("src/app/settings/page.tsx");

    expect(nav).not.toContain('| "tasks"');
    expect(nav).not.toContain('href: "/settings/tasks"');
    expect(settingsRoot).not.toContain('tasks: "/settings/tasks"');
    expect(existsSync(resolve(process.cwd(), "src/app/settings/tasks"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/components/settings/TasksSection.tsx"))).toBe(false);
  });

  it("工作区只保留 Git 固定标签和动态预览", () => {
    const model = source("src/lib/workspace-sidebar.ts");
    const tabBar = source("src/components/layout/WorkspaceSidebar/TabBar.tsx");
    const tabPanel = source("src/components/layout/WorkspaceSidebar/TabPanel.tsx");

    expect(model).toContain("export type FixedTabId = 'git';");
    expect(model).not.toContain("{ id: 'widget', kind: 'fixed' }");
    expect(tabBar).not.toContain("workspaceSidebar.tab.widget");
    expect(tabPanel).not.toContain("DashboardPanel");
    expect(tabPanel).toContain("GitTabContent");
    expect(tabPanel).toContain("PreviewPanel");
    expect(tabPanel).toContain("FileTreePanel");
  });

  it("聊天页不再挂载旧 runtime、任务和批量生图入口", () => {
    const appShell = source("src/components/layout/AppShell.tsx");
    const chatView = source("src/components/chat/ChatView.tsx");
    const generalSettings = source("src/components/settings/GeneralSection.tsx");

    expect(appShell).not.toContain("BatchImageGenContext");
    expect(appShell).not.toContain("useBatchImageGenState");
    expect(chatView).not.toContain("RuntimeSelector");
    expect(chatView).not.toContain("TaskCheckpoint");
    expect(chatView).not.toContain("BatchExecutionDashboard");
    expect(chatView).not.toContain("BatchContextSync");
    expect(chatView).not.toContain("widget-pin-request");
    expect(chatView).not.toContain("dashboard-widget-drilldown");
    expect(chatView).not.toContain("dashboard-command");
    expect(chatView).not.toContain("image-gen-completed");
    expect(generalSettings).not.toContain('value="dashboard"');
    expect(generalSettings).not.toContain("generative_ui_enabled");
  });

  it("保留核心聊天和 app-server 状态展示作为反例", () => {
    const chatView = source("src/components/chat/ChatView.tsx");
    const newChat = source("src/app/chat/page.tsx");
    const appServerProvider = source("src/codex-web/AppServerProvider.tsx");

    expect(chatView).toContain("<MessageList");
    expect(chatView).toContain("<MessageInput");
    expect(chatView).toContain("<PermissionPrompt");
    expect(chatView).toContain("<AppServerRequestPrompt");
    expect(chatView).toContain("<GoalProgressRow");
    expect(appServerProvider).toContain("persistTurnAttachments");
    expect(newChat).toContain("useAppServerActions");
    expect(newChat).toContain("useAppServerSelector");
  });
});
