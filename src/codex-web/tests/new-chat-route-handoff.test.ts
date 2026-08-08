import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../app/chat/[id]/page.tsx", import.meta.url), "utf8");

describe("新对话详情路由交接", () => {
  it("详情加载期间继续展示已接受的用户问题", () => {
    expect(source).toContain("const loadingHandoffMessages = appServerSyncedUserMessages.map");
    expect(source).toContain("loadingHandoffMessages.length > 0");
    expect(source).toContain('data-testid="chat-route-handoff"');
    expect(source).toContain("messages={loadingHandoffMessages}");
  });

  it("没有交接消息时仍使用既有加载状态", () => {
    expect(source).toContain("<SpinnerGap size={32}");
  });
});
