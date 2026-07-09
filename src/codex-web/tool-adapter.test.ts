import { describe, expect, it } from "vitest";

import type { AppServerTurnState } from "./turn-reducer";
import { createStartingTurnState } from "./turn-reducer";
import { deriveCodexWebToolState } from "./tool-adapter";

describe("deriveCodexWebToolState", () => {
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
});
