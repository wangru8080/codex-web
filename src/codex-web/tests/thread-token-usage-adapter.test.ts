import { describe, expect, it } from "vitest";

import { reduceThreadTokenUsageNotification } from "../thread-token-usage-adapter";

const tokenUsage = {
  total: {
    totalTokens: 480_000,
    inputTokens: 460_000,
    cachedInputTokens: 200_000,
    outputTokens: 20_000,
    reasoningOutputTokens: 4_000,
  },
  last: {
    totalTokens: 191_000,
    inputTokens: 185_000,
    cachedInputTokens: 80_000,
    outputTokens: 6_000,
    reasoningOutputTokens: 1_000,
  },
  modelContextWindow: 353_000,
};

describe("thread token usage notification", () => {
  it("按线程保存 app-server 权威用量", () => {
    expect(reduceThreadTokenUsageNotification({}, {
      method: "thread/tokenUsage/updated",
      params: { threadId: "thread-1", turnId: "turn-1", tokenUsage },
    })).toEqual({
      "thread-1": {
        source: "app-server.thread/tokenUsage/updated",
        data: tokenUsage,
      },
    });
  });

  it("忽略无关 notification", () => {
    const current = {
      "thread-1": {
        source: "app-server.thread/tokenUsage/updated" as const,
        data: tokenUsage,
      },
    };

    expect(reduceThreadTokenUsageNotification(current, {
      method: "turn/started",
      params: {},
    })).toBe(current);
  });

  it("非法用量不会覆盖已有线程状态", () => {
    const current = {
      "thread-1": {
        source: "app-server.thread/tokenUsage/updated" as const,
        data: tokenUsage,
      },
    };

    expect(reduceThreadTokenUsageNotification(current, {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-2",
        tokenUsage: { ...tokenUsage, last: { ...tokenUsage.last, totalTokens: "191000" } },
      },
    })).toBe(current);

    expect(reduceThreadTokenUsageNotification(current, {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-2",
        tokenUsage: { ...tokenUsage, modelContextWindow: -1 },
      },
    })).toBe(current);
  });
});
