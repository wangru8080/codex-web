import { describe, expect, it } from "vitest";

import { buildTurnInterruptParams, selectTurnInterruptParams } from "./interrupt-adapter";

describe("buildTurnInterruptParams", () => {
  it("按官方 turn/interrupt schema 构造 running turn 中断参数", () => {
    const params = buildTurnInterruptParams({
      threadId: "thread-1",
      turnId: "turn-1",
    });

    expect(params).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("没有 turnId 时使用空字符串触发官方 startup interrupt 语义", () => {
    const params = buildTurnInterruptParams({
      threadId: "thread-1",
    });

    expect(params).toEqual({
      threadId: "thread-1",
      turnId: "",
    });
  });

  it("从 active turn 派生中断参数", () => {
    const params = selectTurnInterruptParams({
      activeTurn: { threadId: "thread-1", turnId: "turn-1", status: "running" },
    });

    expect(params).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("没有 active thread 时不发中断请求", () => {
    const params = selectTurnInterruptParams({
      activeTurn: null,
    });

    expect(params).toBeNull();
  });

  it("terminal turn 不重复发送中断请求", () => {
    const params = selectTurnInterruptParams({
      activeTurn: { threadId: "thread-1", turnId: "turn-1", status: "completed" },
    });

    expect(params).toBeNull();
  });
});
