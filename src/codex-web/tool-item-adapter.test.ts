import { describe, expect, it } from "vitest";

import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import {
  codexWebRunningOutputFromItem,
  codexWebToolResultFromItem,
  codexWebToolUseFromItem,
} from "./tool-item-adapter";
import { TOOL_OUTPUT_DISPLAY_BYTE_LIMIT } from "./tool-output-display";

describe("tool-item-adapter", () => {
  it("映射 commandExecution 的状态、breadcrumb 和非零 exit code", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "npm test",
      cwd: "/repo",
      processId: "proc-1",
      source: "agent",
      status: "completed",
      commandActions: [],
      aggregatedOutput: "failed tests\n",
      exitCode: 1,
      durationMs: 1200,
    };

    expect(codexWebToolUseFromItem(item)).toEqual({
      id: "cmd-1",
      name: "bash",
      input: expect.objectContaining({
        command: "npm test",
        cwd: "/repo",
        source: "agent",
        status: "completed",
        durationMs: 1200,
        exitCode: 1,
        sourceBreadcrumb: "app-server.commandExecution",
      }),
    });
    expect(codexWebToolResultFromItem(item)).toEqual({
      tool_use_id: "cmd-1",
      content: expect.stringContaining("exit code: 1"),
      is_error: true,
    });
  });

  it("映射 app-server webSearch item", () => {
    const running: ThreadItem = {
      type: "webSearch",
      id: "search-1",
      query: "今天科技新闻",
      action: null,
    };
    const completed: ThreadItem = {
      ...running,
      action: { type: "search", query: "今天科技新闻", queries: null },
    };

    expect(codexWebToolUseFromItem(completed)).toEqual({
      id: "search-1",
      name: "web_search",
      input: {
        query: "今天科技新闻",
        action: completed.action,
        sourceBreadcrumb: "app-server.webSearch",
      },
    });
    expect(codexWebToolResultFromItem(running)).toBeNull();
    expect(codexWebToolResultFromItem(completed)).toMatchObject({
      tool_use_id: "search-1",
      content: expect.stringContaining("source: app-server.webSearch"),
      is_error: false,
    });
  });

  it("把 declined command 和 failed fileChange 映射为 error", () => {
    const declinedCommand: ThreadItem = {
      type: "commandExecution",
      id: "cmd-declined",
      command: "rm -rf tmp",
      cwd: "/repo",
      processId: null,
      source: "agent",
      status: "declined",
      commandActions: [],
      aggregatedOutput: "",
      exitCode: null,
      durationMs: null,
    };
    const failedPatch: ThreadItem = {
      type: "fileChange",
      id: "patch-failed",
      changes: [{ path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" }],
      status: "failed",
    };

    expect(codexWebToolResultFromItem(declinedCommand)).toMatchObject({ is_error: true });
    expect(codexWebToolResultFromItem(failedPatch)).toMatchObject({
      content: expect.stringContaining("failed: 1 file"),
      is_error: true,
    });
  });

  it("映射 MCP content block is_error、isError 和 error message", () => {
    const completedResult: ThreadItem = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "docs",
      tool: "search",
      status: "completed",
      arguments: { q: "codex" },
      appContext: null,
      pluginId: null,
      result: {
        content: [{ type: "text", text: "bad", is_error: true }],
        structuredContent: null,
        _meta: null,
      },
      error: null,
      durationMs: 25,
    };
    const camelCaseErrorResult: ThreadItem = {
      ...completedResult,
      id: "mcp-camel",
      result: {
        content: [{ type: "text", text: "bad", isError: true }],
        structuredContent: null,
        _meta: null,
      },
    };
    const failedByError: ThreadItem = {
      ...completedResult,
      id: "mcp-2",
      status: "failed",
      result: null,
      error: { message: "MCP unavailable" },
    };

    expect(codexWebToolResultFromItem(completedResult)).toMatchObject({ is_error: true });
    expect(codexWebToolResultFromItem(camelCaseErrorResult)).toMatchObject({ is_error: true });
    expect(codexWebToolResultFromItem(failedByError)).toEqual({
      tool_use_id: "mcp-2",
      content: "MCP unavailable",
      is_error: true,
    });
  });

  it("映射 dynamic tool 和 collab tool", () => {
    const dynamicItem: ThreadItem = {
      type: "dynamicToolCall",
      id: "dyn-1",
      namespace: "browser",
      tool: "open",
      arguments: { url: "http://localhost:3000" },
      status: "completed",
      contentItems: [{ type: "inputText", text: "opened" }],
      success: false,
      durationMs: 10,
    };
    const collabItem: ThreadItem = {
      type: "collabAgentToolCall",
      id: "collab-1",
      tool: "wait",
      status: "failed",
      senderThreadId: "thread-a",
      receiverThreadIds: ["thread-b"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: { "thread-b": { status: "errored", message: "boom" } },
    };

    expect(codexWebToolUseFromItem(dynamicItem)).toMatchObject({ name: "dynamic:browser/open" });
    expect(codexWebToolResultFromItem(dynamicItem)).toMatchObject({ is_error: true });
    expect(codexWebToolUseFromItem(collabItem)).toMatchObject({ name: "collab:wait" });
    expect(codexWebToolResultFromItem(collabItem)).toMatchObject({
      content: expect.stringContaining("thread-b: errored"),
      is_error: true,
    });
  });

  it("映射 imageView 和 imageGeneration 图片输出", () => {
    const viewed: ThreadItem = {
      type: "imageView",
      id: "image-view-1",
      path: "/repo/output/chart.webp",
    };
    const generated: ThreadItem = {
      type: "imageGeneration",
      id: "image-gen-1",
      status: "completed",
      revisedPrompt: "一张精确的架构图",
      result: "ignored-when-saved-path-exists",
      savedPath: "/isolated-codex-home/generated/image-gen-1.png",
    };

    expect(codexWebToolUseFromItem(viewed)).toMatchObject({
      name: "view_image",
      input: { sourceBreadcrumb: "app-server.imageView" },
    });
    expect(codexWebToolResultFromItem(viewed)).toMatchObject({
      media: [{
        type: "image",
        mimeType: "image/webp",
        localPath: "/repo/output/chart.webp",
      }],
    });
    expect(codexWebToolUseFromItem(generated)).toMatchObject({ name: "image_generation" });
    expect(codexWebToolResultFromItem(generated)).toMatchObject({
      content: expect.stringContaining("source: app-server.imageGeneration"),
      media: [{
        type: "image",
        mimeType: "image/png",
        localPath: "/isolated-codex-home/generated/image-gen-1.png",
      }],
    });
  });

  it("图片生成没有 savedPath 时使用协议 Base64，开始态不提前生成结果", () => {
    const started: ThreadItem = {
      type: "imageGeneration",
      id: "image-gen-running",
      status: "",
      revisedPrompt: null,
      result: "",
    };
    const completed: ThreadItem = {
      ...started,
      status: "completed",
      result: "aW1hZ2U=",
    };

    expect(codexWebToolResultFromItem(started)).toBeNull();
    expect(codexWebToolResultFromItem(completed)).toMatchObject({
      media: [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }],
    });
  });

  it("提取 dynamic 和 MCP 图片，文本输出不包含 Base64", () => {
    const dynamicItem: ThreadItem = {
      type: "dynamicToolCall",
      id: "dyn-image",
      namespace: "canvas",
      tool: "render",
      arguments: {},
      status: "completed",
      contentItems: [
        { type: "inputText", text: "rendered" },
        { type: "inputImage", imageUrl: "data:image/jpeg;base64,aW1hZ2U=" },
      ],
      success: true,
      durationMs: 4,
    };
    const mcpItem: ThreadItem = {
      type: "mcpToolCall",
      id: "mcp-image",
      server: "charts",
      tool: "render",
      status: "completed",
      arguments: {},
      appContext: null,
      pluginId: null,
      result: {
        content: [{ type: "image", data: "bWNwLWltYWdl", mimeType: "image/png" }],
        structuredContent: null,
        _meta: null,
      },
      error: null,
      durationMs: 5,
    };

    const dynamicResult = codexWebToolResultFromItem(dynamicItem);
    expect(dynamicResult).toMatchObject({
      media: [{ type: "image", mimeType: "image/jpeg", data: "aW1hZ2U=" }],
    });
    expect(dynamicResult?.content).toContain("[图片输出]");
    expect(dynamicResult?.content).not.toContain("aW1hZ2U=");

    const mcpResult = codexWebToolResultFromItem(mcpItem);
    expect(mcpResult).toMatchObject({
      media: [{ type: "image", mimeType: "image/png", data: "bWNwLWltYWdl" }],
    });
    expect(mcpResult?.content).toContain("[图片输出]");
    expect(mcpResult?.content).not.toContain("bWNwLWltYWdl");
  });

  it("无图片的动态工具结果不生成 media 字段", () => {
    const item: ThreadItem = {
      type: "dynamicToolCall",
      id: "dyn-text",
      namespace: null,
      tool: "echo",
      arguments: {},
      status: "completed",
      contentItems: [{ type: "inputText", text: "只有文本" }],
      success: true,
      durationMs: 1,
    };

    expect(codexWebToolResultFromItem(item)).not.toHaveProperty("media");
  });

  it("运行中 item 不产生 result，但保留增量输出", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-running",
      command: "sleep 1",
      cwd: "/repo",
      processId: "proc-running",
      source: "agent",
      status: "inProgress",
      commandActions: [],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    };

    expect(codexWebToolResultFromItem(item)).toBeNull();
    expect(codexWebRunningOutputFromItem(item, { output: "still running\n" })).toBe(
      "still running\n",
    );
  });

  it("截断超大 command 输出时仍保留状态和 exit code", () => {
    const largeOutput = `head\n${"x".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}\ntail`;
    const item: ThreadItem = {
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
      durationMs: 42,
    };

    const result = codexWebToolResultFromItem(item);

    expect(result?.content).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
    expect(result?.content).toContain("head");
    expect(result?.content).not.toContain("tail");
    expect(result?.content).toContain("status: completed");
    expect(result?.content).toContain("exit code: 0");
    expect(result?.content).toContain("source: app-server.commandExecution");
  });

  it("非工具 item 不产生工具信息", () => {
    const item: ThreadItem = {
      type: "agentMessage",
      id: "msg-1",
      text: "done",
      phase: null,
      memoryCitation: null,
    };

    expect(codexWebToolUseFromItem(item)).toBeNull();
    expect(codexWebToolResultFromItem(item)).toBeNull();
    expect(codexWebRunningOutputFromItem(item)).toBe("");
  });
});
