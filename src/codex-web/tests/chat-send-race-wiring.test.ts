import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../components/chat/ChatView.tsx", import.meta.url), "utf8");
const appServerBranch = source.slice(
  source.indexOf("if (appServerSend) {", source.indexOf("const sendMessage = useCallback")),
  source.indexOf("// Hoist provider-state guards", source.indexOf("const sendMessage = useCallback")),
);

describe("app-server 用户消息弱网时序", () => {
  it("等待 turn/start 前先展示用户消息", () => {
    const appendIndex = appServerBranch.indexOf("cappedSetMessages((prev) => [...prev, optimisticUserMessage])");
    const requestIndex = appServerBranch.indexOf("await appServerSend({");

    expect(appendIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(-1);
    expect(appendIndex).toBeLessThan(requestIndex);
  });

  it("接受后原位补充 turn 信息，未接受即失败时精确撤回", () => {
    expect(appServerBranch).toContain("message.id === optimisticUserMessage.id");
    expect(appServerBranch).toContain("id: `temp-user-${turnId}`");
    expect(appServerBranch).toContain("turn_id: turnId");
    expect(appServerBranch).toContain("prev.filter((message) => message.id !== optimisticUserMessage.id)");
    expect(appServerBranch).toContain("onAppServerUserMessageAccepted?.({");
  });
});
