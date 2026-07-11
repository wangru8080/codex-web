import { describe, expect, it } from "vitest";

import {
  rememberActiveTurnByThread,
  removeStartingActiveTurnByThread,
  selectActiveTurnByThreadIds,
  selectOtherRunningActiveTurns,
} from "./active-turns-adapter";
import { createAcceptedTurnState, createStartingTurnState } from "./turn-reducer";

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
});
