import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";

import { threadToChatSession, threadToMessages } from "./thread-history-adapter";

describe("thread-history-adapter", () => {
  it("把 app-server Thread 映射为 CodexWeb 会话项", () => {
    const session = threadToChatSession(createThread());

    expect(session).toMatchObject({
      id: "thread-1",
      title: "修复测试",
      working_directory: "/repo/web",
      project_name: "web",
      origin: "codex_rollout",
      read_only: true,
      provider_id: "codex_account",
      runtime_pin: "codex_runtime",
    });
  });

  it("把历史 turn 中的 user/assistant item 映射为消息", () => {
    const result = threadToMessages(createThread());

    expect(result.messages).toEqual([
      expect.objectContaining({
        id: "user-1",
        role: "user",
        content: "你好",
        created_at: "2026-07-09T04:06:40.000Z",
      }),
      expect.objectContaining({
        id: "assistant-1",
        role: "assistant",
        content: "你好，Codex。",
        created_at: "2026-07-09T04:06:43.000Z",
      }),
    ]);
    expect(result.unsupportedItemCount).toBe(1);
  });
});

function createThread(): Thread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "修复测试",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1783570000,
    updatedAt: 1783570100,
    recencyAt: 1783570100,
    status: { type: "idle" },
    path: null,
    cwd: "/repo/web",
    cliVersion: "0.143.0",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [
      {
        id: "turn-1",
        items: [
          {
            type: "userMessage",
            id: "user-1",
            clientId: null,
            content: [{ type: "text", text: "你好", text_elements: [] }],
          },
          {
            type: "commandExecution",
            id: "cmd-1",
            command: "pwd",
            cwd: "/repo/web",
            processId: null,
            source: "agent",
            status: "completed",
            commandActions: [],
            aggregatedOutput: "/repo/web\n",
            exitCode: 0,
            durationMs: 12,
          },
          {
            type: "agentMessage",
            id: "assistant-1",
            text: "你好，Codex。",
            phase: null,
            memoryCitation: null,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570000,
        completedAt: 1783570003,
        durationMs: 3000,
      },
    ],
  };
}
