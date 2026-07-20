import { describe, expect, it } from "vitest";

import {
  buildTurnInterruptParams,
  readActiveTurnIdMismatch,
  requestTurnInterrupt,
  selectTurnInterruptParams,
} from "./interrupt-adapter";

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

  it("显式 thread 参数不受其它 terminal active turn 影响", () => {
    const params = selectTurnInterruptParams({
      activeTurn: { threadId: "thread-b", turnId: "turn-b", status: "completed" },
      params: { threadId: "thread-a", turnId: "turn-a" },
    });

    expect(params).toEqual({
      threadId: "thread-a",
      turnId: "turn-a",
    });
  });
});

describe("requestTurnInterrupt", () => {
  it("active turn id 竞态时使用服务端报告的 id 重试一次", async () => {
    const requests: Array<{ threadId: string; turnId: string }> = [];
    const request = async (params: { threadId: string; turnId: string }) => {
      requests.push(params);
      if (requests.length === 1) {
        throw new Error("expected active turn id turn-stale but found turn-current");
      }
    };

    await requestTurnInterrupt(request, { threadId: "thread-1", turnId: "turn-stale" });

    expect(requests).toEqual([
      { threadId: "thread-1", turnId: "turn-stale" },
      { threadId: "thread-1", turnId: "turn-current" },
    ]);
  });

  it("普通错误不重试并原样抛出", async () => {
    const error = new Error("Web bridge 连接已关闭");
    let requestCount = 0;

    await expect(requestTurnInterrupt(async () => {
      requestCount += 1;
      throw error;
    }, { threadId: "thread-1", turnId: "turn-1" })).rejects.toBe(error);

    expect(requestCount).toBe(1);
  });

  it("服务端报告相同 turn id 时不重复请求", async () => {
    const error = new Error("expected active turn id turn-1 but found turn-1");
    let requestCount = 0;

    await expect(requestTurnInterrupt(async () => {
      requestCount += 1;
      throw error;
    }, { threadId: "thread-1", turnId: "turn-1" })).rejects.toBe(error);

    expect(requestCount).toBe(1);
  });
});

describe("readActiveTurnIdMismatch", () => {
  it("只提取官方 active turn mismatch 消息中的实际 id", () => {
    expect(readActiveTurnIdMismatch(
      new Error("expected active turn id turn-old but found turn-new"),
    )).toBe("turn-new");
    expect(readActiveTurnIdMismatch(new Error("request failed"))).toBeNull();
    expect(readActiveTurnIdMismatch(
      new Error("prefix expected active turn id turn-old but found turn-new"),
    )).toBeNull();
  });
});
