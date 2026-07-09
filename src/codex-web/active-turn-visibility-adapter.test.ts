import { describe, expect, it } from "vitest";

import { selectVisibleActiveTurn } from "./active-turn-visibility-adapter";
import { createStartingTurnState } from "./turn-reducer";

describe("selectVisibleActiveTurn", () => {
  it("显示当前路由 thread 的 active turn", () => {
    const activeTurn = {
      ...createStartingTurnState(),
      threadId: "thread-a",
      turnId: "turn-a",
    };

    expect(selectVisibleActiveTurn({ activeTurn, routeThreadId: "thread-a" })).toEqual({
      visibleTurn: activeTurn,
      notice: null,
    });
  });

  it("显示 resume 后真实 thread id 的 active turn", () => {
    const activeTurn = {
      ...createStartingTurnState(),
      threadId: "resumed-thread",
      turnId: "turn-a",
    };

    expect(
      selectVisibleActiveTurn({
        activeTurn,
        routeThreadId: "history-thread",
        resumedThreadId: "resumed-thread",
      }),
    ).toEqual({ visibleTurn: activeTurn, notice: null });
  });

  it("隐藏其它 thread 的 active turn 并返回 degraded 提示", () => {
    const activeTurn = {
      ...createStartingTurnState(),
      threadId: "thread-b",
      turnId: "turn-b",
    };

    const result = selectVisibleActiveTurn({ activeTurn, routeThreadId: "thread-a" });

    expect(result.visibleTurn).toBeNull();
    expect(result.notice?.message).toContain("其它 Codex 会话正在运行");
    expect(result.notice?.description).toContain("不会串到本页");
  });

  it("其它 thread 已结束时不显示 degraded 提示", () => {
    const activeTurn = {
      ...createStartingTurnState(),
      status: "completed" as const,
      threadId: "thread-b",
      turnId: "turn-b",
    };

    expect(selectVisibleActiveTurn({ activeTurn, routeThreadId: "thread-a" })).toEqual({
      visibleTurn: null,
      notice: null,
    });
  });
});
