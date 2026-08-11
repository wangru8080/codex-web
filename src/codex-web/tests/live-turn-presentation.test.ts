import { describe, expect, it } from "vitest";

import { createAcceptedTurnState, createStartingTurnState } from "../turn-reducer";
import {
  appServerTurnPresentationKey,
  shouldPresentAppServerTurnAsStreaming,
} from "../live-turn-presentation";

describe("shouldPresentAppServerTurnAsStreaming", () => {
  it("本地标记残留但已无活动 Turn 时隐藏流式行", () => {
    expect(
      shouldPresentAppServerTurnAsStreaming({
        turn: null,
        localStreaming: true,
        finalizedTurnKey: "",
      }),
    ).toBe(false);
  });

  it("展示尚未取得 turnId 的本地 starting 状态", () => {
    expect(
      shouldPresentAppServerTurnAsStreaming({
        turn: createStartingTurnState(),
        localStreaming: true,
        finalizedTurnKey: "",
      }),
    ).toBe(true);
  });

  it("展示当前 running turn", () => {
    expect(
      shouldPresentAppServerTurnAsStreaming({
        turn: createAcceptedTurnState("thread-1", "turn-1"),
        localStreaming: false,
        finalizedTurnKey: "",
      }),
    ).toBe(true);
  });

  it("终态尚未完成历史入列时保留实时结果", () => {
    const turn = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      status: "completed" as const,
    };

    expect(
      shouldPresentAppServerTurnAsStreaming({
        turn,
        localStreaming: true,
        finalizedTurnKey: "",
      }),
    ).toBe(true);
  });

  it("终态完成历史入列后不再同时展示实时副本", () => {
    const turn = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      status: "completed" as const,
    };

    expect(
      shouldPresentAppServerTurnAsStreaming({
        turn,
        localStreaming: true,
        finalizedTurnKey: "thread-1:turn-1",
      }),
    ).toBe(false);
  });

  it("同一 turn 完成后即使状态迟到回退也不重新展示", () => {
    const turn = createAcceptedTurnState("thread-1", "turn-1");

    expect(
      shouldPresentAppServerTurnAsStreaming({
        turn,
        localStreaming: true,
        finalizedTurnKey: "thread-1:turn-1",
      }),
    ).toBe(false);
  });

  it("下一轮 running turn 仍正常展示", () => {
    const turn = createAcceptedTurnState("thread-1", "turn-2");

    expect(
      shouldPresentAppServerTurnAsStreaming({
        turn,
        localStreaming: false,
        finalizedTurnKey: "thread-1:turn-1",
      }),
    ).toBe(true);
  });

  it("仅为具有 threadId 和 turnId 的 turn 生成完成边界 key", () => {
    expect(appServerTurnPresentationKey(createAcceptedTurnState("thread-1", "turn-1"))).toBe(
      "thread-1:turn-1",
    );
    expect(appServerTurnPresentationKey(createStartingTurnState())).toBe("");
    expect(appServerTurnPresentationKey(null)).toBe("");
  });
});
