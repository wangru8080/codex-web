import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("首次设置弹窗移除", () => {
  it("AppShell 不再加载或触发首次设置弹窗", () => {
    const appShell = source("src/components/layout/AppShell.tsx");

    expect(appShell).not.toContain("SetupCenter");
    expect(appShell).not.toContain("/api/setup");
    expect(appShell).not.toContain("open-setup-center");
    expect(appShell).toContain("router.replace('/settings/codex')");
  });

  it("仍有产品价值的配置入口统一进入 Codex 设置", () => {
    const emptyState = source("src/components/chat/ChatEmptyState.tsx");
    const streamManager = source("src/lib/stream-session-manager.ts");
    const about = source("src/components/settings/AboutSection.tsx");
    const connectionStatus = source("src/components/layout/ConnectionStatus.tsx");

    expect(emptyState).toContain("window.location.assign('/settings/codex')");
    expect(streamManager).toContain("window.location.assign('/settings/codex')");
    expect(emptyState).not.toContain("open-setup-center");
    expect(streamManager).not.toContain("open-setup-center");
    expect(about).not.toContain("about.support.runSetupWizard");
    expect(about).not.toContain("open-setup-center");
    expect(connectionStatus).not.toContain("open-setup-center");
  });

  it("移除弹窗专用组件、类型和翻译键", () => {
    const types = source("src/types/index.ts");
    const english = source("src/i18n/en.ts");
    const chinese = source("src/i18n/zh.ts");

    expect(existsSync(resolve(process.cwd(), "src/components/setup"))).toBe(false);
    expect(types).not.toContain("SetupCardStatus");
    expect(types).not.toContain("SetupState");
    expect(english).not.toMatch(/["']setup\./);
    expect(chinese).not.toMatch(/["']setup\./);
    expect(english).not.toContain("about.support.runSetupWizard");
    expect(chinese).not.toContain("about.support.runSetupWizard");
  });

  it("保留新聊天欢迎态作为反例", () => {
    const newChatPage = source("src/app/chat/page.tsx");
    const chatView = source("src/components/chat/ChatView.tsx");

    expect(newChatPage).toContain("<NewChatWelcome />");
    expect(chatView).toContain("<NewChatWelcome");
  });
});
