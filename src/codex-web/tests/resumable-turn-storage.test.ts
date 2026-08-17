import { describe, expect, it } from "vitest";

import {
  readResumableTurn,
  writeResumableTurns,
} from "../resumable-turn-storage";
import { createAcceptedTurnState } from "../turn-reducer";

describe("resumable turn storage", () => {
  it("只保存运行 Turn 并按 threadId 读取", () => {
    const storage = memoryStorage();
    const running = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "断线前正文",
      planText: "执行中的计划",
    };
    const completed = {
      ...createAcceptedTurnState("thread-2", "turn-2"),
      status: "completed" as const,
      assistantText: "已完成正文",
    };

    writeResumableTurns(storage, [running, completed]);

    expect(readResumableTurn(storage, "thread-1")).toMatchObject({
      status: "running",
      threadId: "thread-1",
      turnId: "turn-1",
      assistantText: "断线前正文",
      planText: "执行中的计划",
    });
    expect(readResumableTurn(storage, "thread-2")).toBeNull();
  });

  it("无效 JSON、无效结构和存储异常均返回 null", () => {
    const invalidJson = memoryStorage("{");
    const invalidState = memoryStorage(JSON.stringify({ "thread-1": { status: "running" } }));
    const unavailable = {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
    };

    expect(readResumableTurn(invalidJson, "thread-1")).toBeNull();
    expect(readResumableTurn(invalidState, "thread-1")).toBeNull();
    expect(readResumableTurn(unavailable, "thread-1")).toBeNull();
    expect(() => writeResumableTurns(unavailable, [
      createAcceptedTurnState("thread-1", "turn-1"),
    ])).not.toThrow();
  });
});

function memoryStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  };
}
