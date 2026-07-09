import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";

import { mergeThreadTurnMessages, threadTurnsPageToMessages } from "./thread-turns-page-adapter";

describe("thread-turns-page-adapter", () => {
  it("把 desc turns page 转成按时间正序展示的消息", () => {
    const messages = threadTurnsPageToMessages(createThread(), [
      createTurn("turn-3", "user-3", "third", 30),
      createTurn("turn-2", "user-2", "second", 20),
    ]);

    expect(messages.map((message) => message.content)).toEqual(["second", "third"]);
  });

  it("把 asc turns page 保持按时间正序展示", () => {
    const messages = threadTurnsPageToMessages(
      createThread(),
      [
        createTurn("turn-1", "user-1", "first", 10),
        createTurn("turn-2", "user-2", "second", 20),
      ],
      "asc",
    );

    expect(messages.map((message) => message.content)).toEqual(["first", "second"]);
  });

  it("prepend 合并时不重复已有消息", () => {
    const thread = createThread();
    const existing = threadTurnsPageToMessages(thread, [
      createTurn("turn-3", "user-3", "third", 30),
      createTurn("turn-2", "user-2", "second", 20),
    ]);
    const incoming = threadTurnsPageToMessages(thread, [
      createTurn("turn-2", "user-2", "second", 20),
      createTurn("turn-1", "user-1", "first", 10),
    ]);

    const merged = mergeThreadTurnMessages(existing, incoming, "prepend");

    expect(merged.map((message) => message.content)).toEqual(["first", "second", "third"]);
    expect(merged.map((message) => message.id)).toEqual(["user-1", "user-2", "user-3"]);
  });
});

function createThread(): Thread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "分页历史",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 10,
    updatedAt: 30,
    recencyAt: 30,
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
    turns: [],
  };
}

function createTurn(turnId: string, itemId: string, text: string, startedAt: number): Turn {
  return {
    id: turnId,
    items: [
      {
        type: "userMessage",
        id: itemId,
        clientId: null,
        content: [{ type: "text", text, text_elements: [] }],
      },
    ],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt,
    completedAt: startedAt + 1,
    durationMs: 1000,
  };
}
