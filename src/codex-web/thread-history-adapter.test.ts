import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";

import { threadToChatSession, threadToMessages } from "./thread-history-adapter";
import { TOOL_OUTPUT_DISPLAY_BYTE_LIMIT } from "./tool-output-display";

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

    const assistantContent = JSON.parse(result.messages[1].content);
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: "user-1",
        role: "user",
        content: "你好",
        created_at: "2026-07-09T04:06:40.000Z",
      }),
      expect.objectContaining({
        role: "assistant",
        created_at: "2026-07-09T04:06:43.000Z",
      }),
    ]);
    expect(assistantContent).toEqual([
      {
        type: "tool_use",
        id: "cmd-1",
        name: "bash",
        input: {
          command: "pwd",
          cwd: "/repo/web",
          source: "agent",
          actions: [],
        },
      },
      {
        type: "tool_result",
        tool_use_id: "cmd-1",
        content: "/repo/web\nexit code: 0",
        is_error: false,
      },
      {
        type: "text",
        text: "你好，Codex。",
      },
    ]);
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("把历史 fileChange 和 mcpToolCall 映射为 CodexWeb 工具块", () => {
    const result = threadToMessages(createThreadWithPatchAndMcp());
    const assistantContent = JSON.parse(result.messages[0].content);

    expect(assistantContent).toEqual([
      {
        type: "tool_use",
        id: "patch-1",
        name: "fileChange",
        input: {
          status: "completed",
          files: ["src/app.ts"],
          changes: [
            {
              path: "src/app.ts",
              kind: { type: "update", move_path: null },
              diff: "@@",
            },
          ],
        },
      },
      {
        type: "tool_result",
        tool_use_id: "patch-1",
        content: "completed: 1 file\n- update: src/app.ts",
        is_error: false,
      },
      {
        type: "tool_use",
        id: "mcp-1",
        name: "mcp:docs/search",
        input: {
          server: "docs",
          tool: "search",
          arguments: { q: "codex" },
          appContext: null,
        },
      },
      {
        type: "tool_result",
        tool_use_id: "mcp-1",
        content: "{\"ok\":true}",
        is_error: false,
      },
    ]);
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("截断历史 commandExecution 和 MCP 大输出", () => {
    const thread = createThreadWithLargeToolOutput();
    const result = threadToMessages(thread);
    const assistantContent = JSON.parse(result.messages[0].content);

    expect(assistantContent[1].content).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
    expect(assistantContent[1].content).toContain("command-head");
    expect(assistantContent[1].content).not.toContain("command-tail");
    expect(assistantContent[1].content).toContain("exit code: 0");
    expect(assistantContent[3].content).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
    expect(assistantContent[3].content).toContain("mcp-head");
    expect(assistantContent[3].content).not.toContain("mcp-tail");
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

function createThreadWithPatchAndMcp(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-2",
        items: [
          {
            type: "fileChange",
            id: "patch-1",
            changes: [
              { path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" },
            ],
            status: "completed",
          },
          {
            type: "mcpToolCall",
            id: "mcp-1",
            server: "docs",
            tool: "search",
            status: "completed",
            arguments: { q: "codex" },
            appContext: null,
            pluginId: null,
            result: {
              content: [],
              structuredContent: { ok: true },
              _meta: null,
            },
            error: null,
            durationMs: 15,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570200,
        completedAt: 1783570201,
        durationMs: 1000,
      },
    ],
  };
}

function createThreadWithLargeToolOutput(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-large",
        items: [
          {
            type: "commandExecution",
            id: "cmd-large",
            command: "cat big.log",
            cwd: "/repo/web",
            processId: null,
            source: "agent",
            status: "completed",
            commandActions: [],
            aggregatedOutput: `command-head\n${"x".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}\ncommand-tail`,
            exitCode: 0,
            durationMs: 12,
          },
          {
            type: "mcpToolCall",
            id: "mcp-large",
            server: "docs",
            tool: "read",
            status: "completed",
            arguments: { id: "large" },
            appContext: null,
            pluginId: null,
            result: {
              content: [],
              structuredContent: {
                text: `mcp-head\n${"y".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}\nmcp-tail`,
              },
              _meta: null,
            },
            error: null,
            durationMs: 15,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570300,
        completedAt: 1783570301,
        durationMs: 1000,
      },
    ],
  };
}
