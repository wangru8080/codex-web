import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Hook Web UI 接线", () => {
  it("设置页使用 app-server Hook 列表和官方文档链接", () => {
    const section = readFileSync(resolve(process.cwd(), "src/components/settings/HooksSection.tsx"), "utf8");
    expect(section).toContain("appServer.listHooks");
    expect(section).toContain("https://learn.chatgpt.com/docs/hooks");
    expect(section).toContain("buildHookTrustEdit");
    expect(section).toContain("appServer.writeFile");
  });

  it("输入框只根据 app-server 待审查 Hook 显示提示", () => {
    const input = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInput.tsx"), "utf8");
    expect(input).toContain("appServer.listHooks");
    expect(input).toContain("filter(hookNeedsReview)");
    expect(input).toContain('data-testid="composer-hooks-review"');
    expect(input).toContain('href="/settings/hooks"');
  });

  it("Provider 直接调用官方 hooks/list", () => {
    const provider = readFileSync(resolve(process.cwd(), "src/codex-web/AppServerProvider.tsx"), "utf8");
    expect(provider).toContain('client.request("hooks/list"');
  });
});
