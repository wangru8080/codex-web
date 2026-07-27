import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import { threadRollbackToMessages } from "../thread-rollback";

const provider = readFileSync(new URL("../AppServerProvider.tsx", import.meta.url), "utf8");

function thread(turns: Thread["turns"]): Thread {
  return {
    id: "thread-1",
    preview: "测试会话",
    ephemeral: false,
    modelProvider: "OpenAI",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "idle" },
    cwd: "/workspace",
    cliVersion: "0.144.6",
    source: "user",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns,
  } as unknown as Thread;
}

describe("thread rollback", () => {
  it("Provider 使用官方 thread/rollback method 和原样参数", () => {
    expect(provider).toContain('client.request("thread/rollback", params)');
    expect(provider).toContain("rollbackThread: (params: ThreadRollbackParams)");
  });

  it("只从 rollback 响应中的剩余 turns 重建消息", () => {
    const result = threadRollbackToMessages(thread([
      {
        id: "turn-1",
        items: [
          { id: "user-1", type: "userMessage", content: [{ type: "text", text: "第一个问题" }] },
          { id: "assistant-1", type: "agentMessage", text: "第一个回答", phase: "final_answer" },
        ],
        status: "completed",
        error: null,
        startedAt: 10,
        completedAt: 11,
      },
    ] as Thread["turns"]));

    expect(result.map((message) => message.id)).toEqual(["user-1", "assistant-1"]);
    expect(result.map((message) => message.content).join("\n")).not.toContain("第二个问题");
  });

  it("空 rollback 历史得到空消息，不保留前端旧轮", () => {
    expect(threadRollbackToMessages(thread([]))).toEqual([]);
  });
});
