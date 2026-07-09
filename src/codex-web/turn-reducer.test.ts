import { describe, expect, it } from "vitest";

import {
  createStartingTurnState,
  initialAppServerTurnState,
  reduceAppServerTurnNotification,
} from "./turn-reducer";

describe("reduceAppServerTurnNotification", () => {
  it("按 app-server 事件构建 one-turn 流式状态", () => {
    let state = createStartingTurnState();

    state = reduceAppServerTurnNotification(state, {
      method: "thread/started",
      params: { thread: { id: "thread-1" } },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", id: "item-1", text: "", phase: null, memoryCitation: null },
      },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "你好" },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "，Codex" },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", id: "item-1", text: "你好，Codex。", phase: null, memoryCitation: null },
      },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", error: null },
      },
    });

    expect(state).toMatchObject({
      status: "completed",
      threadId: "thread-1",
      turnId: "turn-1",
      assistantText: "你好，Codex。",
      errorMessage: "",
    });
    expect(state.items).toHaveLength(1);
  });

  it("把 app-server error 映射为失败态", () => {
    const state = reduceAppServerTurnNotification(initialAppServerTurnState, {
      method: "error",
      params: { message: "模型不可用" },
    });

    expect(state.status).toBe("failed");
    expect(state.errorMessage).toBe("模型不可用");
  });

  it("保存工具输出、文件 patch 和 MCP progress 增量", () => {
    let state = createStartingTurnState();

    state = reduceAppServerTurnNotification(state, {
      method: "item/commandExecution/outputDelta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "cmd-1", delta: "hello" },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/commandExecution/outputDelta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "cmd-1", delta: "\nworld" },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/fileChange/patchUpdated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "patch-1",
        changes: [{ path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" }],
      },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/mcpToolCall/progress",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "mcp-1", message: "查询中" },
    });

    expect(state.toolOutputs["cmd-1"]).toBe("hello\nworld");
    expect(state.filePatchChanges["patch-1"]).toEqual([
      { path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" },
    ]);
    expect(state.mcpProgress["mcp-1"]).toBe("查询中\n");
  });
});
