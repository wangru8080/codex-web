import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";

import {
  applyTurnSnapshotsToMessages,
  latestHistoryTurnFromPage,
  mergeThreadTurnMessages,
  threadTurnsPageToMessages,
} from "../thread-turns-page-adapter";
import { appServerTurnSnapshotKey, createAcceptedTurnState } from "../turn-reducer";

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

  it("分页历史为实时 Turn 省略 assistant，但保留同 Turn 用户消息", () => {
    const turn = createTurnWithAssistant(
      "turn-live",
      "user-live",
      "agent-live",
      "正在处理",
      10,
    );
    const messages = threadTurnsPageToMessages(
      createThread(),
      [turn],
      "asc",
      {},
      { omitAssistantTurnId: "turn-live" },
    );

    expect(messages).toEqual([
      expect.objectContaining({ id: "user-live", role: "user", content: "user prompt" }),
    ]);
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

  it("desc page 第一项是最新历史 turn", () => {
    const latest = latestHistoryTurnFromPage(
      [
        { ...createTurn("turn-3", "user-3", "third", 30), status: "interrupted" },
        createTurn("turn-2", "user-2", "second", 20),
      ],
      "desc",
      "app-server.thread/turns/list",
    );

    expect(latest).toEqual({
      status: "interrupted",
      source: "app-server.thread/turns/list",
    });
  });

  it("asc page 最后一项是最新历史 turn", () => {
    const latest = latestHistoryTurnFromPage(
      [
        { ...createTurn("turn-1", "user-1", "first", 10), status: "interrupted" },
        createTurn("turn-2", "user-2", "second", 20),
      ],
      "asc",
      "app-server.thread/read",
    );

    expect(latest).toEqual({
      status: "completed",
      source: "app-server.thread/read",
    });
  });

  it("空 turns page 没有最新历史状态", () => {
    expect(
      latestHistoryTurnFromPage([], "desc", "app-server.thread/turns/list"),
    ).toBeNull();
  });

  it("用当前进程内 notification 快照恢复同一 turn 的 completed 过程块", () => {
    const turn = createTurnWithAssistant("turn-1", "user-1", "agent-1", "final answer", 10);
    const thread = { ...createThread(), turns: [turn] };
    const messages = threadTurnsPageToMessages(thread, [turn], "asc");
    const snapshot = {
      ...createAcceptedTurnState(thread.id, turn.id),
      status: "completed" as const,
      assistantText: "final answer",
      durationMs: 1200,
      items: [
        {
          type: "commandExecution" as const,
          id: "cmd-1",
          command: "pwd",
          cwd: "/repo/web",
          processId: null,
          source: "agent" as const,
          status: "completed" as const,
          commandActions: [],
          aggregatedOutput: "/repo/web\n",
          exitCode: 0,
          durationMs: 10,
        },
      ],
    };

    const restored = applyTurnSnapshotsToMessages(thread, messages, {
      [appServerTurnSnapshotKey(thread.id, turn.id)]: {
        source: "app-server.notification",
        data: snapshot,
      },
    });
    const assistantContent = JSON.parse(restored[1].content);

    expect(messages[1].content).toBe("final answer");
    expect(assistantContent).toEqual([
      expect.objectContaining({ type: "tool_use", id: "cmd-1", name: "bash" }),
      expect.objectContaining({ type: "tool_result", tool_use_id: "cmd-1" }),
      { type: "codex_summary", elapsed_ms: 1200, process_count: 1 },
      { type: "text", text: "final answer" },
    ]);
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

function createTurnWithAssistant(
  turnId: string,
  userItemId: string,
  agentItemId: string,
  text: string,
  startedAt: number,
): Turn {
  return {
    id: turnId,
    items: [
      {
        type: "userMessage",
        id: userItemId,
        clientId: null,
        content: [{ type: "text", text: "user prompt", text_elements: [] }],
      },
      {
        type: "agentMessage",
        id: agentItemId,
        text,
        phase: null,
        memoryCitation: null,
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
