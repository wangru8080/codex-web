import { describe, expect, it } from "vitest";

import type { AppServerTurnState } from "./turn-reducer";
import { createStartingTurnState } from "./turn-reducer";
import { deriveCodexWebToolState } from "./tool-adapter";
import { TOOL_OUTPUT_DISPLAY_BYTE_LIMIT } from "./tool-output-display";

describe("deriveCodexWebToolState", () => {
  it("把 webSearch 映射为完成的搜索工具 cell", () => {
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [{
        type: "webSearch",
        id: "search-1",
        query: "今天科技新闻",
        action: { type: "search", query: "今天科技新闻", queries: null },
      }],
    };

    const state = deriveCodexWebToolState(turn);
    expect(state.toolUses).toEqual([
      expect.objectContaining({ id: "search-1", name: "web_search" }),
    ]);
    expect(state.toolResults).toEqual([
      expect.objectContaining({ tool_use_id: "search-1", is_error: false }),
    ]);
  });

  it("把运行中的 commandExecution 映射为 CodexWeb 工具 cell", () => {
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [
        {
          type: "commandExecution",
          id: "cmd-1",
          command: "npm test",
          cwd: "/repo",
          processId: "proc-1",
          source: "agent",
          status: "inProgress",
          commandActions: [{ type: "unknown", command: "npm test" }],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      ],
      toolOutputs: { "cmd-1": "running tests\n" },
    };

    const state = deriveCodexWebToolState(turn);

    expect(state.toolUses).toEqual([
      expect.objectContaining({
        id: "cmd-1",
        name: "bash",
        input: expect.objectContaining({ command: "npm test", cwd: "/repo" }),
      }),
    ]);
    expect(state.toolResults).toEqual([]);
    expect(state.streamingToolOutput).toBe("running tests\n");
  });

  it("实时 adapter 保留 command 状态 breadcrumb 且不把 interrupted turn 写成工具状态", () => {
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      status: "interrupted",
      items: [
        {
          type: "commandExecution",
          id: "cmd-1",
          command: "sleep 60",
          cwd: "/repo",
          processId: "proc-1",
          source: "agent",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "",
          exitCode: 0,
          durationMs: 100,
        },
      ],
    };

    const state = deriveCodexWebToolState(turn);

    expect(state.toolUses[0].input).toMatchObject({
      status: "completed",
      sourceBreadcrumb: "app-server.commandExecution",
    });
    expect(state.toolUses[0].input).not.toMatchObject({ status: "interrupted" });
    expect(state.toolResults[0]).toMatchObject({ is_error: false });
  });

  it("实时 adapter 显示 dynamic 和 collab 工具 item", () => {
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [
        {
          type: "dynamicToolCall",
          id: "dyn-1",
          namespace: null,
          tool: "analyze",
          arguments: { file: "a.ts" },
          status: "completed",
          contentItems: [{ type: "inputText", text: "done" }],
          success: true,
          durationMs: 12,
        },
        {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "thread-a",
          receiverThreadIds: ["thread-b"],
          prompt: "review",
          model: null,
          reasoningEffort: null,
          agentsStates: { "thread-b": { status: "completed", message: null } },
        },
      ],
    };

    const state = deriveCodexWebToolState(turn);

    expect(state.toolUses.map((tool) => tool.name)).toEqual(["dynamic:analyze", "collab:spawnAgent"]);
    expect(state.toolResults).toHaveLength(2);
    expect(state.toolResults.every((result) => result.is_error === false)).toBe(true);
  });

  it("把完成的 fileChange 映射为结果摘要", () => {
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [
        {
          type: "fileChange",
          id: "patch-1",
          changes: [],
          status: "completed",
        },
      ],
      filePatchChanges: {
        "patch-1": [
          { path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" },
        ],
      },
    };

    const state = deriveCodexWebToolState(turn);

    expect(state.toolUses).toEqual([
      expect.objectContaining({
        id: "patch-1",
        name: "fileChange",
        input: expect.objectContaining({ files: ["src/app.ts"] }),
      }),
    ]);
    expect(state.toolResults).toEqual([
      expect.objectContaining({
        tool_use_id: "patch-1",
        content: expect.stringContaining("src/app.ts"),
        is_error: false,
      }),
    ]);
  });

  it("把 MCP progress 和失败结果映射到工具输出", () => {
    const runningTurn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [
        {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "docs",
          tool: "search",
          status: "inProgress",
          arguments: { q: "codex" },
          appContext: null,
          pluginId: null,
          result: null,
          error: null,
          durationMs: null,
        },
      ],
      mcpProgress: { "mcp-1": "searching\n" },
    };

    expect(deriveCodexWebToolState(runningTurn)).toMatchObject({
      streamingToolOutput: "searching",
      toolResults: [],
    });

    const failedTurn: AppServerTurnState = {
      ...runningTurn,
      items: [
        {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "docs",
          tool: "search",
          status: "failed",
          arguments: { q: "codex" },
          appContext: null,
          pluginId: null,
          result: null,
          error: { message: "MCP unavailable" },
          durationMs: 120,
        },
      ],
    };

    expect(deriveCodexWebToolState(failedTurn).toolResults).toEqual([
      {
        tool_use_id: "mcp-1",
        content: "MCP unavailable",
        is_error: true,
      },
    ]);
  });

  it("截断运行中的 commandExecution 大输出", () => {
    const largeOutput = `head\n${"x".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}\ntail`;
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [
        {
          type: "commandExecution",
          id: "cmd-large",
          command: "yes",
          cwd: "/repo",
          processId: "proc-large",
          source: "agent",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      ],
      toolOutputs: { "cmd-large": largeOutput },
    };

    const state = deriveCodexWebToolState(turn);

    expect(state.streamingToolOutput).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
    expect(state.streamingToolOutput).toContain("head");
    expect(state.streamingToolOutput).not.toContain("tail");
    expect(state.streamingToolOutput.length).toBeLessThan(largeOutput.length);
  });

  it("截断完成的 commandExecution 大输出并保留 exit code", () => {
    const largeOutput = `start\n${"x".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}\nend`;
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [
        {
          type: "commandExecution",
          id: "cmd-large",
          command: "cat big.log",
          cwd: "/repo",
          processId: null,
          source: "agent",
          status: "completed",
          commandActions: [],
          aggregatedOutput: largeOutput,
          exitCode: 0,
          durationMs: 100,
        },
      ],
    };

    const [result] = deriveCodexWebToolState(turn).toolResults;

    expect(result.content).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
    expect(result.content).toContain("start");
    expect(result.content).not.toContain("end");
    expect(result.content).toContain("exit code: 0");
    expect(result.content.length).toBeLessThan(largeOutput.length);
  });

  it("截断完成的 fileChange 大输出", () => {
    const largeOutput = `patch head\n${"x".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}\npatch tail`;
    const turn: AppServerTurnState = {
      ...createStartingTurnState(),
      items: [
        {
          type: "fileChange",
          id: "patch-large",
          changes: [
            { path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" },
          ],
          status: "completed",
        },
      ],
      toolOutputs: { "patch-large": largeOutput },
    };

    const [result] = deriveCodexWebToolState(turn).toolResults;

    expect(result.content).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
    expect(result.content).toContain("completed: 1 file");
    expect(result.content).not.toContain("patch tail");
    expect(result.content.length).toBeLessThan(largeOutput.length);
  });
});
