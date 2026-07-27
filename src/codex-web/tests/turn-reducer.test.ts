import { describe, expect, it } from "vitest";

import {
  createAcceptedTurnState,
  createStartingTurnState,
  initialAppServerTurnState,
  mergeAcceptedTurnState,
  reduceAppServerTurnNotification,
} from "../turn-reducer";

describe("reduceAppServerTurnNotification", () => {
  it("跟踪 contextCompaction item 的开始和完成状态", () => {
    const started = reduceAppServerTurnNotification(initialAppServerTurnState, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "contextCompaction", id: "compact-1" },
      },
    });

    expect(started.contextCompactionStatusById).toEqual({ "compact-1": "inProgress" });

    const completed = reduceAppServerTurnNotification(started, {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "contextCompaction", id: "compact-1" },
      },
    });

    expect(completed.contextCompactionStatusById).toEqual({ "compact-1": "completed" });
  });

  it("新 turn 开始时清除上一回合内容", () => {
    const previous = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      status: "completed" as const,
      assistantText: "上一回合",
      items: [{ type: "contextCompaction" as const, id: "old-compact" }],
      contextCompactionStatusById: { "old-compact": "completed" as const },
    };

    const next = reduceAppServerTurnNotification(previous, {
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-2", status: "inProgress" } },
    });

    expect(next).toEqual(createAcceptedTurnState("thread-1", "turn-2"));
  });

  it("turn/started 保存 app-server 的 Unix 秒开始时间", () => {
    const next = reduceAppServerTurnNotification(createStartingTurnState(), {
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "inProgress", startedAt: 1_785_000_000 },
      },
    });

    expect(next.startedAtMs).toBe(1_785_000_000_000);
  });

  it("turn/started 缺少有效开始时间时保持兼容回退", () => {
    const next = reduceAppServerTurnNotification(createStartingTurnState(), {
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "inProgress", startedAt: null },
      },
    });

    expect(next.startedAtMs).toBeUndefined();
  });

  it("turn/start 响应先到时，后续同 Turn notification 不清空已有起点", () => {
    const accepted = createAcceptedTurnState("thread-1", "turn-1", 1_785_000_000_000);
    const next = reduceAppServerTurnNotification(accepted, {
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "inProgress", startedAt: null },
      },
    });

    expect(next.startedAtMs).toBe(1_785_000_000_000);
  });

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
      method: "item/reasoning/summaryTextDelta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "reasoning-1", delta: "先确认上下文。" },
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
        turn: { id: "turn-1", status: "completed", error: null, durationMs: 3000 },
      },
    });

    expect(state).toMatchObject({
      status: "completed",
      threadId: "thread-1",
      turnId: "turn-1",
      assistantText: "你好，Codex。",
      reasoningText: "先确认上下文。",
      durationMs: 3000,
      errorMessage: "",
    });
    expect(state.items).toHaveLength(1);
  });

  it("可重试的 app-server error 保持运行并保存真实错误详情", () => {
    const state = reduceAppServerTurnNotification(
      createAcceptedTurnState("thread-1", "turn-1"),
      {
        method: "error",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          willRetry: true,
          error: {
            message: "正在重新连接 3/5",
            additionalDetails: "unexpected status 503 Service Unavailable",
            codexErrorInfo: "serverOverloaded",
          },
        },
      },
    );

    expect(state.status).toBe("running");
    expect(state.errorMessage).toBe("");
    expect(state.retryStatus).toEqual({
      message: "正在重新连接 3/5",
      additionalDetails: "unexpected status 503 Service Unavailable",
    });
  });

  it("非重试 app-server error 映射为失败态", () => {
    const state = reduceAppServerTurnNotification(createAcceptedTurnState("thread-1", "turn-1"), {
      method: "error",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: false,
        error: { message: "模型不可用", additionalDetails: null, codexErrorInfo: "other" },
      },
    });

    expect(state.status).toBe("failed");
    expect(state.errorMessage).toBe("模型不可用");
    expect(state.retryStatus).toBeNull();
  });

  it("可重试错误后的普通 notification 清除重试状态", () => {
    const retrying = reduceAppServerTurnNotification(createAcceptedTurnState("thread-1", "turn-1"), {
      method: "error",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: true,
        error: { message: "正在重新连接 1/5", additionalDetails: null, codexErrorInfo: "other" },
      },
    });

    const recovered = reduceAppServerTurnNotification(retrying, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "已恢复" },
    });

    expect(recovered.status).toBe("running");
    expect(recovered.retryStatus).toBeNull();
  });

  it("按 itemId 分别累积 commentary 与 final answer", () => {
    let state = createAcceptedTurnState("thread-1", "turn-1");
    state = reduceAppServerTurnNotification(state, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", id: "comment-1", text: "", phase: "commentary", memoryCitation: null },
      },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "comment-1", delta: "先搜索。" },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", id: "final-1", text: "", phase: "final_answer", memoryCitation: null },
      },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "final-1", delta: "搜索完成。" },
    });

    expect(state.items).toMatchObject([
      { id: "comment-1", text: "先搜索。", phase: "commentary" },
      { id: "final-1", text: "搜索完成。", phase: "final_answer" },
    ]);
    expect(state.assistantText).toBe("搜索完成。");
  });

  it("保存工具输出、Turn diff、文件 patch 和 MCP progress 增量", () => {
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
      method: "turn/diff/updated",
      params: { threadId: "thread-1", turnId: "turn-1", diff: "diff --git a/src/app.ts b/src/app.ts" },
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
    expect(state.turnDiff).toBe("diff --git a/src/app.ts b/src/app.ts");
    expect(state.filePatchChanges["patch-1"]).toEqual([
      { path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" },
    ]);
    expect(state.mcpProgress["mcp-1"]).toBe("查询中\n");
  });

  it("把 plan delta、completed plan 和 updated plan 纳入 turn 状态", () => {
    let state = createAcceptedTurnState("thread-1", "turn-1");

    state = reduceAppServerTurnNotification(state, {
      method: "item/plan/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "plan-1", delta: "1. 写测试" },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "item/plan/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "plan-1", delta: "\n2. 实现" },
    });
    expect(state.planBlocks).toEqual([
      {
        type: "codex_proposed_plan",
        text: "1. 写测试\n2. 实现",
        sourceBreadcrumb: "app-server.item/plan/delta",
      },
    ]);

    state = reduceAppServerTurnNotification(state, {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "plan", id: "plan-1", text: "1. 写测试\n2. 实现\n3. 验证" },
      },
    });
    state = reduceAppServerTurnNotification(state, {
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        explanation: "同步进度。",
        plan: [
          { step: "写测试", status: "completed" },
          { step: "实现", status: "inProgress" },
        ],
      },
    });

    expect(state.latestProposedPlanMarkdown).toBe("1. 写测试\n2. 实现\n3. 验证");
    expect(state.taskProgress).toEqual({ completed: 1, total: 2 });
    expect(state.planBlocks).toEqual([
      {
        type: "codex_proposed_plan",
        text: "1. 写测试\n2. 实现\n3. 验证",
        sourceBreadcrumb: "app-server.item/completed",
      },
      {
        type: "codex_updated_plan",
        explanation: "同步进度。",
        steps: [
          { step: "写测试", status: "completed" },
          { step: "实现", status: "inProgress" },
        ],
        sourceBreadcrumb: "app-server.turn/plan/updated",
        progress: { completed: 1, total: 2 },
      },
    ]);
  });

  it("turn/start accepted 只进入 running，不要求等待 turn/completed", () => {
    const accepted = createAcceptedTurnState("thread-1", "turn-1");

    expect(accepted).toMatchObject({
      status: "running",
      threadId: "thread-1",
      turnId: "turn-1",
      assistantText: "",
    });
  });

  it("accepted 状态不会覆盖已经到达的终态 notification", () => {
    const completed = reduceAppServerTurnNotification(createAcceptedTurnState("thread-1", "turn-1"), {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", error: null },
      },
    });

    const merged = mergeAcceptedTurnState(completed, createAcceptedTurnState("thread-1", "turn-1"));

    expect(merged.status).toBe("completed");
  });

  it("turn/started notification 先到时，accepted 状态保留已有起点", () => {
    const notified = createAcceptedTurnState("thread-1", "turn-1", 1_785_000_000_000);
    const merged = mergeAcceptedTurnState(
      notified,
      createAcceptedTurnState("thread-1", "turn-1", 1_785_000_001_000),
    );

    expect(merged.startedAtMs).toBe(1_785_000_000_000);
  });
});
