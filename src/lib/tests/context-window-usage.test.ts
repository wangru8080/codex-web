import { describe, expect, it } from "vitest";

import { contextWindowUsageDisplay, formatContextTokens } from "../context-window-usage";

describe("上下文窗口展示", () => {
  it("使用 last.totalTokens 而不是线程累计 total.totalTokens", () => {
    expect(contextWindowUsageDisplay({
      total: {
        totalTokens: 999_000,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 191_000,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: 353_000,
    })).toEqual({
      hasData: true,
      usedTokens: 191_000,
      totalTokens: 353_000,
      percentUsed: 54,
    });
  });

  it("上下文窗口未知时不伪造百分比", () => {
    expect(contextWindowUsageDisplay({
      total: { totalTokens: 10, inputTokens: 10, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      last: { totalTokens: 10, inputTokens: 10, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      modelContextWindow: null,
    })).toEqual({
      hasData: false,
      usedTokens: 10,
      totalTokens: null,
      percentUsed: 0,
    });
  });

  it("超过窗口时把圆环限制为 100%", () => {
    expect(contextWindowUsageDisplay({
      total: { totalTokens: 120, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      last: { totalTokens: 120, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      modelContextWindow: 100,
    }).percentUsed).toBe(100);
  });

  it("按截图格式展示紧凑 Token 数", () => {
    expect(formatContextTokens(191_000)).toBe("191k");
    expect(formatContextTokens(353_000)).toBe("353k");
    expect(formatContextTokens(980)).toBe("980");
  });
});
