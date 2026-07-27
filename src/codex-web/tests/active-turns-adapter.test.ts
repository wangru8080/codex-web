import { describe, expect, it } from "vitest";

import {
  failRunningTurnOnTransportClose,
  failRunningTurnsOnTransportClose,
  rememberActiveTurnByThread,
  removeActiveTurnByThread,
  removeStartingActiveTurnByThread,
  selectActiveTurnByThreadIds,
  selectOtherRunningActiveTurns,
} from "../active-turns-adapter";
import { createAcceptedTurnState, createStartingTurnState } from "../turn-reducer";

describe("active-turns-adapter", () => {
  it("按 threadId 分别保存多个 active turn", () => {
    const turnA = createAcceptedTurnState("thread-a", "turn-a");
    const turnB = createAcceptedTurnState("thread-b", "turn-b");

    const activeTurns = rememberActiveTurnByThread(
      rememberActiveTurnByThread({}, turnA),
      turnB,
    );

    expect(selectActiveTurnByThreadIds(activeTurns, ["thread-a"])).toBe(turnA);
    expect(selectActiveTurnByThreadIds(activeTurns, ["thread-b"])).toBe(turnB);
  });

  it("支持历史 route id 和 resume 后真实 thread id 两种查找键", () => {
    const resumedTurn = createAcceptedTurnState("resumed-thread", "turn-a");
    const activeTurns = rememberActiveTurnByThread({}, resumedTurn);

    expect(selectActiveTurnByThreadIds(activeTurns, ["history-thread", "resumed-thread"])).toBe(resumedTurn);
  });

  it("只移除同 thread 的 starting turn，不影响其它 running turn", () => {
    const starting = { ...createStartingTurnState(), threadId: "thread-a" };
    const running = createAcceptedTurnState("thread-b", "turn-b");
    const activeTurns = rememberActiveTurnByThread(
      rememberActiveTurnByThread({}, starting),
      running,
    );

    const next = removeStartingActiveTurnByThread(activeTurns, "thread-a");

    expect(selectActiveTurnByThreadIds(next, ["thread-a"])).toBeNull();
    expect(selectActiveTurnByThreadIds(next, ["thread-b"])).toBe(running);
  });

  it("resume 确认没有运行 Turn 时只移除对应 thread", () => {
    const turnA = createAcceptedTurnState("thread-a", "turn-a");
    const turnB = createAcceptedTurnState("thread-b", "turn-b");
    const activeTurns = rememberActiveTurnByThread(rememberActiveTurnByThread({}, turnA), turnB);

    const next = removeActiveTurnByThread(activeTurns, "thread-a");

    expect(next["thread-a"]).toBeUndefined();
    expect(next["thread-b"]?.data).toBe(turnB);
  });

  it("列出当前 thread 之外的 running turn", () => {
    const runningA = createAcceptedTurnState("thread-a", "turn-a");
    const runningB = createAcceptedTurnState("thread-b", "turn-b");
    const completedC = {
      ...createAcceptedTurnState("thread-c", "turn-c"),
      status: "completed" as const,
    };
    const activeTurns = [runningA, runningB, completedC].reduce(
      (map, turn) => rememberActiveTurnByThread(map, turn),
      {},
    );

    expect(selectOtherRunningActiveTurns(activeTurns, ["thread-a"])).toEqual([runningB]);
  });

  it("failed 和 completed turn 按 threadId 隔离选择，但不算其它 running turn", () => {
    const failedA = {
      ...createAcceptedTurnState("thread-a", "turn-a"),
      status: "failed" as const,
      errorMessage: "boom",
    };
    const completedB = {
      ...createAcceptedTurnState("thread-b", "turn-b"),
      status: "completed" as const,
      assistantText: "done",
    };
    const activeTurns = [failedA, completedB].reduce(
      (map, turn) => rememberActiveTurnByThread(map, turn),
      {},
    );

    expect(selectActiveTurnByThreadIds(activeTurns, ["thread-a"])).toBe(failedA);
    expect(selectActiveTurnByThreadIds(activeTurns, ["thread-b"])).toBe(completedB);
    expect(selectOtherRunningActiveTurns(activeTurns, ["thread-a"])).toEqual([]);
  });

  it("transport close 将 starting 和 running 标为 web-bridge 失败终态", () => {
    const starting = { ...createStartingTurnState(), threadId: "thread-a" };
    const running = createAcceptedTurnState("thread-b", "turn-b");
    const activeTurns = [starting, running].reduce(
      (map, turn) => rememberActiveTurnByThread(map, turn),
      {},
    );

    const next = failRunningTurnsOnTransportClose(activeTurns, "Web bridge 连接已关闭");

    expect(next["thread-a"]).toMatchObject({
      source: "web-bridge",
      data: { status: "failed", errorMessage: "Web bridge 连接已关闭" },
    });
    expect(next["thread-b"]).toMatchObject({
      source: "web-bridge",
      data: { status: "failed", errorMessage: "Web bridge 连接已关闭" },
    });
  });

  it("transport close 保持已完成 Turn 不变", () => {
    const completed = {
      source: "app-server.notification" as const,
      data: {
        ...createAcceptedTurnState("thread-a", "turn-a"),
        status: "completed" as const,
      },
    };

    expect(failRunningTurnOnTransportClose(completed, "Web bridge 连接已关闭")).toBe(completed);
  });
});
