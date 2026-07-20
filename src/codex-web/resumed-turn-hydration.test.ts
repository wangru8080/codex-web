import { describe, expect, it } from "vitest";

import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import { activeTurnFromResume } from "./resumed-turn-hydration";

describe("activeTurnFromResume", () => {
  it("从最新 inProgress Turn 恢复真实 item 和聚合输出", () => {
    const turn = activeTurnFromResume(resumeResponse("inProgress"));

    expect(turn).toMatchObject({
      status: "running",
      threadId: "thread-1",
      turnId: "turn-1",
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
