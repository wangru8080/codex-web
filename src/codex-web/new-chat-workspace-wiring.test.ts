import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("新对话文件工作区接线", () => {
  const shell = readFileSync(resolve(process.cwd(), "src/components/layout/AppShell.tsx"), "utf8");
  const topBar = readFileSync(resolve(process.cwd(), "src/components/layout/UnifiedTopBar.tsx"), "utf8");
  const newChat = readFileSync(resolve(process.cwd(), "src/app/chat/page.tsx"), "utf8");

  it("整个聊天路由都挂载右侧面板", () => {
    expect(shell).toContain("const isChatWorkspaceRoute = isChatRoute || isSplitActive");
    expect(shell).toContain("isChatDetailRoute={isChatWorkspaceRoute}");
    expect(topBar).toContain('pathname === "/chat" || pathname.startsWith("/chat/")');
  });

  it("新对话项目目录同步到 AppShell", () => {
    expect(newChat).toContain("setWorkingDirectory(workingDir)");
  });
});
