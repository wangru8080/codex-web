import { describe, expect, it } from "vitest";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";

import {
  nextForkedThreadName,
  threadToChatSession,
  threadToMessages,
} from "../thread-history-adapter";
import { TOOL_OUTPUT_DISPLAY_BYTE_LIMIT } from "../tool-output-display";
import {
  buildFileExcerptPrompt,
  parseFileExcerptDisplay,
  type FileExcerptReference,
} from "@/lib/file-excerpt-reference";

describe("thread-history-adapter", () => {
  it("保留历史 turn 中已完成的上下文压缩提示", () => {
    const thread = createThread();
    const baseTurn = thread.turns[0];
    if (!baseTurn) throw new Error("测试 fixture 缺少 turn");
    thread.turns = [{
      ...baseTurn,
      id: "turn-compact",
      items: [{ type: "contextCompaction", id: "compact-1" }],
      durationMs: 1000,
    }];

    const result = threadToMessages(thread);
    expect(result.unsupportedItemCount).toBe(0);
    expect(JSON.parse(result.messages[0]?.content ?? "[]")).toEqual([
      {
        type: "codex_context_compaction",
        status: "completed",
        sourceBreadcrumb: "app-server.item/completed",
      },
      { type: "codex_summary", elapsed_ms: 1000, process_count: 1 },
    ]);
  });

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

  it("为同项目的分叉任务分配连续标题序号", () => {
    const source = createThread();

    expect(nextForkedThreadName(source, [source])).toBe("修复测试 (2)");
    expect(nextForkedThreadName(source, [
      source,
      { ...source, id: "thread-2", name: "修复测试 (2)" },
      { ...source, id: "thread-3", name: "修复测试 (3)" },
    ])).toBe("修复测试 (4)");
  });

  it("从已编号任务继续分叉时沿用基础标题", () => {
    const source = { ...createThread(), id: "thread-2", name: "修复测试 (2)" };
    const base = { ...createThread(), id: "thread-1" };

    expect(nextForkedThreadName(source, [
      base,
      source,
      { ...source, id: "thread-3", name: "修复测试 (3)" },
    ])).toBe("修复测试 (4)");
  });

  it("忽略其他项目的同名任务且不误拆自然数字后缀", () => {
    const source = { ...createThread(), name: "版本 (2026)" };

    expect(nextForkedThreadName(source, [
      source,
      { ...source, id: "other", cwd: "/repo/other", name: "版本 (2026) (9)" },
    ])).toBe("版本 (2026) (2)");
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
          status: "completed",
          durationMs: 12,
          exitCode: 0,
          processId: null,
          actions: [],
          sourceBreadcrumb: "app-server.commandExecution",
        },
      },
      {
        type: "tool_result",
        tool_use_id: "cmd-1",
        content:
          "/repo/web\nstatus: completed\nexit code: 0\nduration: 12ms\nsource: app-server.commandExecution",
        is_error: false,
      },
      {
        type: "codex_summary",
        elapsed_ms: 3000,
        process_count: 1,
      },
      {
        type: "text",
        text: "你好，Codex。",
      },
    ]);
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("从历史 image 和 localImage 恢复图片附件", () => {
    const thread = createThread();
    thread.turns[0]!.items[0] = {
      type: "userMessage",
      id: "user-images",
      clientId: null,
      content: [
        { type: "image", url: "data:image/png;base64,AAAA" },
        { type: "localImage", path: "/codex-home/attachments/id/photo.jpg" },
        { type: "text", text: "查看图片", text_elements: [] },
      ],
    };

    const result = threadToMessages(thread);
    const match = result.messages[0]!.content.match(/^<!--files:(.*?)-->([\s\S]*)$/);

    expect(match?.[2]).toBe("查看图片");
    expect(JSON.parse(match?.[1] ?? "[]")).toEqual([
      {
        id: "user-images-image-0",
        name: "image-1.png",
        type: "image/png",
        size: 3,
        data: "AAAA",
      },
      {
        id: "user-images-image-1",
        name: "photo.jpg",
        type: "image/jpeg",
        size: 0,
        data: "",
        filePath: "/codex-home/attachments/id/photo.jpg",
      },
    ]);
  });

  it("实时恢复同一 Turn 时保留用户消息并省略 assistant 历史副本", () => {
    const result = threadToMessages(createThread(), {
      omitAssistantTurnId: "turn-1",
    });

    expect(result.messages).toEqual([
      expect.objectContaining({ id: "user-1", role: "user", content: "你好" }),
    ]);
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("省略目标不匹配时保留已完成 assistant 历史", () => {
    const result = threadToMessages(createThread(), {
      omitAssistantTurnId: "turn-other",
    });

    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("保留只有图片而没有文本的历史用户消息", () => {
    const thread = createThread();
    thread.turns[0]!.items = [{
      type: "userMessage",
      id: "user-image-only",
      clientId: null,
      content: [{ type: "image", url: "data:image/webp;base64,AAAA" }],
    }];

    const result = threadToMessages(thread);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.content).toContain('"type":"image/webp"');
  });

  it("解析官方文件信封并恢复普通文件附件", () => {
    const thread = createThread();
    thread.turns[0]!.items[0] = {
      type: "userMessage",
      id: "user-file",
      clientId: null,
      content: [{
        type: "text",
        text: "\n# Files mentioned by the user:\n\n## notes.md: /codex-home/attachments/id/notes.md\n\n## My request for Codex:\n总结文件\n",
        text_elements: [],
      }],
    };

    const result = threadToMessages(thread);
    const match = result.messages[0]!.content.match(/^<!--files:(.*?)-->([\s\S]*)$/);

    expect(match?.[2]).toBe("总结文件");
    expect(JSON.parse(match?.[1] ?? "[]")).toEqual([{
      id: "user-file-file-0",
      name: "notes.md",
      type: "text/markdown",
      size: 0,
      data: "",
      filePath: "/codex-home/attachments/id/notes.md",
    }]);
  });

  it("把图片 block 合并到信封中的图片附件而不重复显示", () => {
    const thread = createThread();
    thread.turns[0]!.items[0] = {
      type: "userMessage",
      id: "user-file-image",
      clientId: null,
      content: [
        { type: "image", url: "data:image/png;base64,AAAA" },
        {
          type: "text",
          text: "\n# Files mentioned by the user:\n\n## photo.png: C:\\Codex\\attachments\\id\\photo.png\n\n## My request for Codex:\n查看图片\n",
          text_elements: [],
        },
      ],
    };

    const result = threadToMessages(thread);
    const match = result.messages[0]!.content.match(/^<!--files:(.*?)-->([\s\S]*)$/);
    const files = JSON.parse(match?.[1] ?? "[]");

    expect(match?.[2]).toBe("查看图片");
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      id: "user-file-image-file-0",
      name: "photo.png",
      type: "image/png",
      size: 3,
      data: "AAAA",
      filePath: "C:\\Codex\\attachments\\id\\photo.png",
    });
  });

  it("恢复包含 Unix 和 Windows 绝对路径的多文件信封", () => {
    const thread = createThread();
    thread.turns[0]!.items[0] = {
      type: "userMessage",
      id: "user-files",
      clientId: null,
      content: [{
        type: "text",
        text: "\n# Files mentioned by the user:\n\n## notes.md: /codex-home/attachments/a/notes.md\n\n## report.pdf: C:\\Codex\\attachments\\b\\report.pdf\n\n## My request for Codex:\n比较文件\n",
        text_elements: [],
      }],
    };

    const result = threadToMessages(thread);
    const match = result.messages[0]!.content.match(/^<!--files:(.*?)-->([\s\S]*)$/);
    const files = JSON.parse(match?.[1] ?? "[]");

    expect(match?.[2]).toBe("比较文件");
    expect(files).toHaveLength(2);
    expect(files).toEqual([
      expect.objectContaining({ name: "notes.md", type: "text/markdown" }),
      expect.objectContaining({ name: "report.pdf", type: "application/pdf" }),
    ]);
  });

  it("解析官方 session 中的相对路径附件信封", () => {
    const thread = createThread();
    const text = "# Files mentioned by the user:\n\n## notes.md: docs/notes.md\n\n## My request for Codex:\n总结文档";
    thread.turns[0]!.items[0] = {
      type: "userMessage",
      id: "user-relative-file",
      clientId: null,
      content: [{ type: "text", text, text_elements: [] }],
    };

    const result = threadToMessages(thread);
    const match = result.messages[0]!.content.match(/^<!--files:(.*?)-->([\s\S]*)$/);

    expect(match?.[2]).toBe("总结文档");
    expect(JSON.parse(match?.[1] ?? "[]")).toEqual([{
      id: "user-relative-file-file-0",
      name: "notes.md",
      type: "text/markdown",
      size: 0,
      data: "",
      filePath: "docs/notes.md",
    }]);
  });

  it("从官方相对 PNG 信封恢复图片附件而不依赖 image block", () => {
    const thread = createThread();
    thread.turns[0]!.items[0] = {
      type: "userMessage",
      id: "user-relative-image",
      clientId: null,
      content: [{
        type: "text",
        text: "\n# Files mentioned by the user:\n\n## baidu_luoyang_moly_first_result_20260624.png: data/baidu_luoyang_moly_first_result_20260624.png\n\n## My request for Codex:\n理解图片\n",
        text_elements: [],
      }],
    };

    const result = threadToMessages(thread);
    const match = result.messages[0]!.content.match(/^<!--files:(.*?)-->([\s\S]*)$/);
    const files = JSON.parse(match?.[1] ?? "[]");

    expect(match?.[2]).toBe("理解图片");
    expect(files).toEqual([expect.objectContaining({
      name: "baidu_luoyang_moly_first_result_20260624.png",
      type: "image/png",
      filePath: "data/baidu_luoyang_moly_first_result_20260624.png",
    })]);
  });

  it("从 app-server 历史提示词恢复文件片段卡片和用户问题", () => {
    const thread = createThread();
    const reference: FileExcerptReference = {
      id: "excerpt-1",
      path: "/repo/web/scripts/run_rsync.sh",
      name: "run_rsync.sh",
      text: "date -u\ndate",
      startLine: 4,
      endLine: 5,
    };
    thread.turns[0]!.items[0] = {
      type: "userMessage",
      id: "user-excerpt",
      clientId: null,
      content: [{
        type: "text",
        text: buildFileExcerptPrompt("这是 UTC 时间吗？", [reference]),
        text_elements: [],
      }],
    };

    const result = threadToMessages(thread);

    expect(parseFileExcerptDisplay(result.messages[0]!.content)).toEqual({
      references: [{
        id: "excerpt-1",
        path: "/repo/web/scripts/run_rsync.sh",
        name: "run_rsync.sh",
        startLine: 4,
        endLine: 5,
      }],
      request: "这是 UTC 时间吗？",
    });
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
          sourceBreadcrumb: "app-server.fileChange",
        },
      },
      {
        type: "tool_result",
        tool_use_id: "patch-1",
        content: "completed: 1 file\n- update: src/app.ts\nsource: app-server.fileChange",
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
          pluginId: null,
          status: "completed",
          durationMs: 15,
          sourceBreadcrumb: "app-server.mcpToolCall",
        },
      },
      {
        type: "tool_result",
        tool_use_id: "mcp-1",
        content: "{\n  \"ok\": true\n}\nstatus: completed\nduration: 15ms\nsource: app-server.mcpToolCall",
        is_error: false,
      },
      {
        type: "codex_summary",
        elapsed_ms: 1000,
        process_count: 2,
      },
    ]);
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("把历史 dynamic 和 collab 工具映射为 CodexWeb 工具块", () => {
    const result = threadToMessages(createThreadWithDynamicAndCollab());
    const assistantContent = JSON.parse(result.messages[0].content);

    expect(assistantContent).toEqual([
      expect.objectContaining({
        type: "tool_use",
        id: "dyn-1",
        name: "dynamic:browser/open",
        input: expect.objectContaining({
          namespace: "browser",
          tool: "open",
          status: "failed",
          success: false,
          durationMs: 10,
          sourceBreadcrumb: "app-server.dynamicToolCall",
        }),
      }),
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "dyn-1",
        content: expect.stringContaining("source: app-server.dynamicToolCall"),
        is_error: true,
      }),
      expect.objectContaining({
        type: "tool_use",
        id: "collab-1",
        name: "collab:wait",
        input: expect.objectContaining({
          status: "completed",
          senderThreadId: "thread-a",
          receiverThreadIds: ["thread-b"],
          sourceBreadcrumb: "app-server.collabAgentToolCall",
        }),
      }),
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "collab-1",
        content: expect.stringContaining("source: app-server.collabAgentToolCall"),
        is_error: false,
      }),
      {
        type: "codex_summary",
        elapsed_ms: 1000,
        process_count: 2,
      },
    ]);
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("把历史 MCP content block is_error 映射为 error result", () => {
    const result = threadToMessages(createThreadWithMcpContentError());
    const assistantContent = JSON.parse(result.messages[0].content);

    expect(assistantContent[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "mcp-error",
      is_error: true,
    });
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("把历史 reasoning 映射为 CodexWeb thinking 过程块", () => {
    const result = threadToMessages(createThreadWithReasoning());
    const assistantContent = JSON.parse(result.messages[0].content);

    expect(assistantContent).toEqual([
      {
        type: "thinking",
        thinking: "我会先确认当前状态。",
      },
      {
        type: "codex_summary",
        elapsed_ms: 1000,
        process_count: 1,
      },
      {
        type: "text",
        text: "已确认。",
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

  it("把历史 ThreadItem::Plan 映射为 Proposed Plan", () => {
    const result = threadToMessages(createThreadWithPlan());
    const assistantContent = JSON.parse(result.messages[0].content);

    expect(assistantContent).toEqual([
      {
        type: "codex_proposed_plan",
        text: "1. 写测试\n2. 实现",
        sourceBreadcrumb: "app-server.item/completed",
      },
      {
        type: "text",
        text: "计划已准备好。",
      },
    ]);
    expect(result.unsupportedItemCount).toBe(0);
  });

  it("assistant final answer 中含 plan 文本不生成 Proposed Plan", () => {
    const result = threadToMessages(createThreadWithPlanTextOnly());

    expect(result.messages[0].content).toBe("Here is a plan-shaped sentence, but it is final answer text.");
    expect(result.unsupportedItemCount).toBe(0);
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

function createThreadWithDynamicAndCollab(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-dynamic",
        items: [
          {
            type: "dynamicToolCall",
            id: "dyn-1",
            namespace: "browser",
            tool: "open",
            arguments: { url: "http://localhost:3000" },
            status: "failed",
            contentItems: [{ type: "inputText", text: "failed" }],
            success: false,
            durationMs: 10,
          },
          {
            type: "collabAgentToolCall",
            id: "collab-1",
            tool: "wait",
            status: "completed",
            senderThreadId: "thread-a",
            receiverThreadIds: ["thread-b"],
            prompt: null,
            model: null,
            reasoningEffort: null,
            agentsStates: { "thread-b": { status: "completed", message: null } },
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

function createThreadWithMcpContentError(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-mcp-error",
        items: [
          {
            type: "mcpToolCall",
            id: "mcp-error",
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
            durationMs: 15,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570350,
        completedAt: 1783570351,
        durationMs: 1000,
      },
    ],
  };
}

function createThreadWithReasoning(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-reasoning",
        items: [
          {
            type: "reasoning",
            id: "reasoning-1",
            summary: ["我会先确认当前状态。"],
            content: ["raw reasoning should stay hidden"],
          },
          {
            type: "agentMessage",
            id: "assistant-1",
            text: "已确认。",
            phase: null,
            memoryCitation: null,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570360,
        completedAt: 1783570361,
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

function createThreadWithPlan(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-plan",
        items: [
          { type: "plan", id: "plan-1", text: "1. 写测试\n2. 实现" },
          {
            type: "agentMessage",
            id: "assistant-plan",
            text: "计划已准备好。",
            phase: null,
            memoryCitation: null,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570400,
        completedAt: 1783570401,
        durationMs: 1000,
      },
    ],
  };
}

function createThreadWithPlanTextOnly(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-plan-text",
        items: [
          {
            type: "agentMessage",
            id: "assistant-plan-text",
            text: "Here is a plan-shaped sentence, but it is final answer text.",
            phase: null,
            memoryCitation: null,
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570410,
        completedAt: 1783570411,
        durationMs: 1000,
      },
    ],
  };
}
