import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";
import { selectVisibleActiveTurn } from "../active-turn-visibility-adapter";
import { createStartingTurnState } from "../turn-reducer";

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

  it("当前 thread 没有 active turn 时也能提示其它 thread 正在运行", () => {
    const otherTurn = {
      ...createStartingTurnState(),
      threadId: "thread-b",
      turnId: "turn-b",
    };

    const result = selectVisibleActiveTurn({
      activeTurn: null,
      otherActiveTurns: [otherTurn],
      routeThreadId: "thread-a",
    });

    expect(result.visibleTurn).toBeNull();
    expect(result.notice?.message).toContain("其它 Codex 会话正在运行");
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

  it("其它 thread 运行隔离 notice 优先于历史 interrupted notice", () => {
    const activeTurn = {
      ...createStartingTurnState(),
      threadId: "thread-b",
      turnId: "turn-b",
    };

    const result = selectVisibleActiveTurn({
      activeTurn,
      routeThreadId: "thread-a",
      latestHistoryTurn: {
        status: "interrupted",
        source: "app-server.thread/turns/list",
      },
    });

    expect(result.visibleTurn).toBeNull();
    expect(result.notice?.message).toBe("其它 Codex 会话正在运行");
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

  it("刷新后最新历史 turn interrupted 时返回来源明确的中断提示", () => {
    const result = selectVisibleActiveTurn({
      activeTurn: null,
      routeThreadId: "thread-a",
      thread: createThreadFixture(),
      latestHistoryTurn: {
        status: "interrupted",
        source: "app-server.thread/turns/list",
      },
    });

    expect(result.visibleTurn).toBeNull();
    expect(result.notice).toEqual({
      message: "Codex 已中断",
      description:
        "此状态来自 app-server.thread/turns/list 的最新 turn；可以继续发送下一轮。",
    });
  });

  it("fallback interrupted notice 使用 thread/read breadcrumb", () => {
    const result = selectVisibleActiveTurn({
      activeTurn: null,
      routeThreadId: "thread-a",
      thread: createThreadFixture(),
      latestHistoryTurn: {
        status: "interrupted",
        source: "app-server.thread/read",
      },
    });

    expect(result.notice?.description).toContain("app-server.thread/read");
  });

  it("最新历史 turn completed 时不显示旧中断提示", () => {
    expect(
      selectVisibleActiveTurn({
        activeTurn: null,
        routeThreadId: "thread-a",
        thread: createThreadFixture({
          turns: [
            createTurnFixture("interrupted", 10),
            createTurnFixture("completed", 20),
          ],
        }),
        latestHistoryTurn: {
          status: "completed",
          source: "app-server.thread/read",
        },
      }),
    ).toEqual({ visibleTurn: null, notice: null });
  });

  it("实时 interrupted turn 优先作为 visibleTurn，不重复显示历史 notice", () => {
    const activeTurn = {
      ...createStartingTurnState(),
      status: "interrupted" as const,
      threadId: "thread-a",
      turnId: "turn-live",
    };

    expect(
      selectVisibleActiveTurn({
        activeTurn,
        routeThreadId: "thread-a",
        latestHistoryTurn: {
          status: "interrupted",
          source: "app-server.thread/turns/list",
        },
      }),
    ).toEqual({ visibleTurn: activeTurn, notice: null });
  });

  it("thread status active 时优先显示运行中 degraded notice", () => {
    const result = selectVisibleActiveTurn({
      activeTurn: null,
      routeThreadId: "thread-a",
      thread: createThreadFixture({
        status: { type: "active", activeFlags: [] },
      }),
      latestHistoryTurn: {
        status: "interrupted",
        source: "app-server.thread/turns/list",
      },
    });

    expect(result.notice?.message).toBe("此会话可能仍在运行");
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

function createTurnFixture(status: Turn["status"], startedAt: number): Turn {
  return {
    id: `turn-${startedAt}`,
    items: [],
    itemsView: "full",
    status,
    error: null,
    startedAt,
    completedAt: status === "inProgress" ? null : startedAt + 1,
    durationMs: status === "inProgress" ? null : 1000,
  };
}
