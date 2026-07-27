import { describe, expect, it } from "vitest";

import { resolveHistoryTurnTarget } from "../history-turn-routing";

describe("history-turn-routing", () => {
  it("首次历史页发送需要先 resume route thread", () => {
    expect(
      resolveHistoryTurnTarget({
        routeThreadId: "history-thread",
        routeCwd: "/repo",
        routeModel: "gpt-5.5",
        defaultModel: "fallback-model",
      }),
    ).toEqual({
      requiresResume: true,
      threadId: "history-thread",
      cwd: "/repo",
      model: "gpt-5.5",
    });
  });

  it("resume 后续发送复用 resumed thread id", () => {
    expect(
      resolveHistoryTurnTarget({
        routeThreadId: "history-thread",
        resumedThreadId: "resumed-thread",
        routeCwd: "/repo",
        resumedCwd: "/repo/resumed",
        requestedCwd: "/repo/requested",
        routeModel: "route-model",
        resumedModel: "resumed-model",
        requestedModel: "requested-model",
        defaultModel: "fallback-model",
      }),
    ).toEqual({
      requiresResume: false,
      threadId: "resumed-thread",
      cwd: "/repo/resumed",
      model: "resumed-model",
    });
  });

  it("没有 route model 时使用请求 model 或默认 model", () => {
    expect(
      resolveHistoryTurnTarget({
        routeThreadId: "history-thread",
        routeCwd: "/repo",
        requestedModel: "requested-model",
        defaultModel: "fallback-model",
      }).model,
    ).toBe("requested-model");

    expect(
      resolveHistoryTurnTarget({
        routeThreadId: "history-thread",
        routeCwd: "/repo",
        defaultModel: "fallback-model",
      }).model,
    ).toBe("fallback-model");
  });
});
