import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";
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

  it("刷新后 thread/read 显示 active 时返回 degraded 提示", () => {
    const result = selectVisibleActiveTurn({
      activeTurn: null,
      routeThreadId: "thread-a",
      thread: createThreadFixture({
        status: { type: "active", activeFlags: [] },
      }),
    });

    expect(result.visibleTurn).toBeNull();
    expect(result.notice?.message).toContain("可能仍在运行");
    expect(result.notice?.description).toContain("app-server.thread/read");
  });

  it("刷新后最后一轮 inProgress 时返回 degraded 提示", () => {
    const result = selectVisibleActiveTurn({
      activeTurn: null,
      routeThreadId: "thread-a",
      thread: createThreadFixture({
        turns: [
          {
            id: "turn-a",
            items: [],
            itemsView: "full",
            status: "inProgress",
            error: null,
            startedAt: 1,
            completedAt: null,
            durationMs: null,
          },
        ],
      }),
    });

    expect(result.notice?.message).toContain("可能仍在运行");
  });

  it("刷新后 completed 历史不显示 degraded 提示", () => {
    expect(
      selectVisibleActiveTurn({
        activeTurn: null,
        routeThreadId: "thread-a",
        thread: createThreadFixture(),
      }),
    ).toEqual({ visibleTurn: null, notice: null });
  });
});

function createThreadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-a",
    sessionId: "session-a",
    forkedFromId: null,
    parentThreadId: null,
    preview: "请只回复：pong",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 2,
    status: { type: "idle" },
    path: null,
    cwd: "/tmp",
    cliVersion: "0.0.0",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}
