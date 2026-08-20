import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../components/layout/ChatListPanel.tsx", import.meta.url),
  "utf8",
);

describe("侧栏新对话导航", () => {
  it("项目新对话使用 replace 避免重复历史导航", () => {
    expect(source).toContain("router.replace(createNewChatHref());");
    expect(source).not.toContain("router.push(createNewChatHref());");
  });

  it("项目新对话先同步工作目录再导航", () => {
    const handlerStart = source.indexOf("const handleCreateSessionInProject");
    const handler = source.slice(handlerStart, source.indexOf("\n  };", handlerStart));
    expect(handler).toContain("localStorage.setItem('codepilot:last-working-directory', workingDirectory)");
    expect(handler).toContain("project-directory-changed");
    expect(handler).toContain("router.replace(createNewChatHref())");
  });
});
