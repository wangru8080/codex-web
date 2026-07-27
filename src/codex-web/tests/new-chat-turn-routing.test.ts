import { describe, expect, it } from "vitest";

import { getExistingNewChatThreadId } from "../new-chat-turn-routing";

describe("new-chat-turn-routing", () => {
  it("没有 session id 时需要新建 thread", () => {
    expect(getExistingNewChatThreadId(undefined)).toBeNull();
  });

  it("临时 app-server session id 不能用于继续发送", () => {
    expect(getExistingNewChatThreadId("app-server-123")).toBeNull();
  });

  it("真实 thread id 用于同一新建页的后续 turn", () => {
    expect(getExistingNewChatThreadId("019f-phase6l-thread")).toBe("019f-phase6l-thread");
  });
});
