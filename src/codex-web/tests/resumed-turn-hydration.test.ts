import { describe, expect, it } from "vitest";

import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import { createAcceptedTurnState, reduceAppServerTurnNotification } from "../turn-reducer";
import { activeTurnFromResume, mergeResumedActiveTurn } from "../resumed-turn-hydration";

describe("activeTurnFromResume", () => {
  it("从最新 inProgress Turn 恢复真实 item 和聚合输出", () => {
    const turn = activeTurnFromResume(resumeResponse("inProgress"));

    expect(turn).toMatchObject({
      status: "running",
      threadId: "thread-1",
      turnId: "turn-1",
      startedAtMs: 1000,
      assistantText: "处理中",
      toolOutputs: { "command-1": "partial output" },
    });
    expect(turn?.items.map((item) => item.id)).toEqual(["command-1", "message-1"]);
  });

  it.each(["completed", "failed", "interrupted"] as const)(
    "最新 Turn 为 %s 时不伪造运行态",
    (status) => {
      expect(activeTurnFromResume(resumeResponse(status))).toBeNull();
    },
  );

  it("没有 Turn 时返回 null", () => {
    const response = resumeResponse("completed");
    response.thread.turns = [];
    expect(activeTurnFromResume(response)).toBeNull();
  });

  it("较早的陈旧 inProgress 不覆盖最新 completed Turn", () => {
    const response = resumeResponse("inProgress");
    const completed = resumeResponse("completed").thread.turns[0];
    if (!completed) throw new Error("测试 fixture 缺少 completed Turn");
    response.thread.turns.push({ ...completed, id: "turn-2" });

    expect(activeTurnFromResume(response)).toBeNull();
  });
});

describe("mergeResumedActiveTurn", () => {
  it("同一 Turn 的空恢复快照保留断线前流式内容", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "已经显示的回复",
      reasoningText: "已经显示的推理",
      toolOutputs: { "command-1": "partial output" },
    };
    const resumed = createAcceptedTurnState("thread-1", "turn-1");

    expect(mergeResumedActiveTurn(current, resumed)).toMatchObject({
      assistantText: "已经显示的回复",
      reasoningText: "已经显示的推理",
      toolOutputs: { "command-1": "partial output" },
    });
  });

  it("同一 Turn 使用更完整的恢复内容", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "部分",
      reasoningText: "思考",
      toolOutputs: { "command-1": "short" },
    };
    const resumed = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "部分回复已经恢复",
      reasoningText: "思考内容已经恢复",
      toolOutputs: { "command-1": "longer output" },
    };

    expect(mergeResumedActiveTurn(current, resumed)).toMatchObject({
      assistantText: "部分回复已经恢复",
      reasoningText: "思考内容已经恢复",
      toolOutputs: { "command-1": "longer output" },
    });
  });

  it("不同 Turn 不合并旧内容", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-old"),
      assistantText: "旧回复",
    };
    const resumed = createAcceptedTurnState("thread-1", "turn-new");

    expect(mergeResumedActiveTurn(current, resumed)).toBe(resumed);
  });

  it("assistant item 变化时采用恢复快照中的新 item", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "旧但更长的回答",
      assistantTextItemId: "message-old",
      items: [agentMessage("message-old", "旧但更长的回答")],
    };
    const resumed = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "新回答",
      assistantTextItemId: "message-new",
      items: [agentMessage("message-new", "新回答")],
    };

    expect(mergeResumedActiveTurn(current, resumed)).toMatchObject({
      assistantText: "新回答",
      assistantTextItemId: "message-new",
      items: [
        { id: "message-old", text: "旧但更长的回答" },
        { id: "message-new", text: "新回答" },
      ],
    });
  });

  it("同一 assistant item 仅在内容保持前缀关系时采用较完整文本", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "部分回复",
      assistantTextItemId: "message-1",
      items: [agentMessage("message-1", "部分回复")],
    };
    const resumedPrefix = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "部分",
      assistantTextItemId: "message-1",
      items: [agentMessage("message-1", "部分")],
    };
    const resumedDiverged = {
      ...resumedPrefix,
      assistantText: "修正回复",
      items: [agentMessage("message-1", "修正回复")],
    };

    expect(mergeResumedActiveTurn(current, resumedPrefix)?.assistantText).toBe("部分回复");
    expect(mergeResumedActiveTurn(current, resumedPrefix)?.items).toMatchObject([
      { id: "message-1", text: "部分回复" },
    ]);
    expect(mergeResumedActiveTurn(current, resumedDiverged)?.assistantText).toBe("修正回复");
  });

  it("合并后继续接收新 item delta 时正文和 item 保持一致", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "旧但更长的回答",
      assistantTextItemId: "message-old",
      items: [agentMessage("message-old", "旧但更长的回答")],
    };
    const resumed = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "新",
      assistantTextItemId: "message-new",
      items: [agentMessage("message-new", "新")],
    };
    const merged = mergeResumedActiveTurn(current, resumed);
    if (!merged) throw new Error("测试 fixture 应产生运行 Turn");

    const next = reduceAppServerTurnNotification(merged, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "message-new", delta: "回答" },
    });

    expect(next.assistantText).toBe("新回答");
    expect(next.items.find((item) => item.id === "message-new")).toMatchObject({ text: "新回答" });
  });

  it("恢复快照把当前 assistant item 确认为 commentary 时清除误归类正文", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      assistantText: "先检查环境。",
      assistantTextItemId: "message-1",
      items: [{ ...agentMessage("message-1", "先检查环境。"), phase: null }],
    };
    const resumed = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      items: [{ ...agentMessage("message-1", "先检查环境。"), phase: "commentary" as const }],
    };

    expect(mergeResumedActiveTurn(current, resumed)).toMatchObject({
      assistantText: "",
      assistantTextItemId: null,
      items: [{ id: "message-1", phase: "commentary", text: "先检查环境。" }],
    });
  });

  it("空恢复快照保留无法从 resume 重建的运行增量", () => {
    const current = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      planText: "执行中的计划",
      turnDiff: "diff --git a/a b/a",
      filePatchChanges: {
        "patch-1": [{ path: "a", kind: { type: "update" as const, move_path: null }, diff: "@@" }],
      },
      mcpProgress: { "mcp-1": "处理中\n" },
      contextCompactionStatusById: { "compact-1": "inProgress" as const },
    };

    expect(mergeResumedActiveTurn(
      current,
      createAcceptedTurnState("thread-1", "turn-1"),
    )).toMatchObject({
      planText: "执行中的计划",
      turnDiff: "diff --git a/a b/a",
      filePatchChanges: current.filePatchChanges,
      mcpProgress: { "mcp-1": "处理中\n" },
      contextCompactionStatusById: { "compact-1": "inProgress" },
    });
  });
});

function agentMessage(id: string, text: string) {
  return { type: "agentMessage" as const, id, text, phase: "final_answer" as const, memoryCitation: null };
}

function resumeResponse(status: "inProgress" | "completed" | "failed" | "interrupted"): ThreadResumeResponse {
  return {
    thread: {
      id: "thread-1",
      turns: [{
        id: "turn-1",
        status,
        itemsView: "full",
        items: [
          {
            type: "commandExecution",
            id: "command-1",
            command: "sleep 5",
            cwd: "/repo",
            processId: "process-1",
            source: "agent",
            status: status === "inProgress" ? "inProgress" : "completed",
            commandActions: [],
            aggregatedOutput: "partial output",
            exitCode: null,
            durationMs: null,
          },
          {
            type: "agentMessage",
            id: "message-1",
            text: "处理中",
            phase: null,
            memoryCitation: null,
          },
        ],
        error: null,
        startedAt: 1,
        completedAt: status === "inProgress" ? null : 2,
        durationMs: status === "inProgress" ? null : 1000,
      }],
    },
  } as ThreadResumeResponse;
}
