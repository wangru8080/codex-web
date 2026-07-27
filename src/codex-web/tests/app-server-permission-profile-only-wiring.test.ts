import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("app-server permission profile 唯一管理", () => {
  it("不再保留旧全局跳过审批开关", () => {
    const legacySources = [
      "src/components/settings/GeneralSection.tsx",
      "src/components/layout/AppShell.tsx",
      "src/components/layout/NavRail.tsx",
      "src/i18n/zh.ts",
      "src/i18n/en.ts",
    ].map(source).join("\n");

    expect(legacySources).not.toContain("dangerously_skip_permissions");
    expect(legacySources).not.toContain("settings.autoApprove");
    expect(legacySources).not.toContain("nav.autoApproveOn");
    expect(existsSync(resolve(process.cwd(), "src/lib/claude-client.ts"))).toBe(false);
  });

  it("Web 不会根据本地 full_access 状态自动响应审批", () => {
    const prompt = source("src/components/chat/PermissionPrompt.tsx");
    const chatView = source("src/components/chat/ChatView.tsx");
    const chatViewPrompt = chatView.match(/<PermissionPrompt[\s\S]*?\/>/)?.[0];

    expect(prompt).not.toContain("permissionProfile?: PermissionProfile");
    expect(prompt).not.toContain("autoApprovedRef");
    expect(chatViewPrompt).toBeDefined();
    expect(chatViewPrompt).not.toContain("permissionProfile={permissionProfile}");
  });

  it("审批操作按钮使用中文文案", () => {
    const prompt = source("src/components/chat/PermissionPrompt.tsx");

    expect(prompt).toContain("拒绝");
    expect(prompt).toContain("允许一次");
    expect(prompt).not.toContain("                Deny");
    expect(prompt).not.toContain("                Allow Once");
  });

  it("保留 full_access 的正式 app-server 映射", () => {
    const runtimeOptions = source("src/codex-web/app-server-runtime-options.ts");

    expect(runtimeOptions).toContain('profile === "full_access"');
    expect(runtimeOptions).toContain('approvalPolicy: "never"');
    expect(runtimeOptions).toContain('permissions: ":danger-full-access"');
    expect(runtimeOptions).toContain('type: "dangerFullAccess"');
  });
});
