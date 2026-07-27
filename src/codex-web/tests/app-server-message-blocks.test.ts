import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import {
  appServerTerminalTurnToMessageContent,
  turnItemsToMessageBlocks,
  turnItemsToMessageContent,
} from "../app-server-message-blocks";
import { createAcceptedTurnState } from "../turn-reducer";

describe("app-server-message-blocks", () => {
  it("把实时上下文压缩转换为带生命周期来源的过程块", () => {
    const content = turnItemsToMessageContent({
      items: [{ type: "contextCompaction", id: "compact-1" }],
      contextCompactionStatusById: { "compact-1": "inProgress" },
    });

    expect(JSON.parse(content)).toEqual([
      {
        type: "codex_context_compaction",
        status: "inProgress",
        sourceBreadcrumb: "app-server.item/started",
      },
      { type: "codex_summary", process_count: 1 },
    ]);
  });

  it("历史上下文压缩默认按完成状态展示，普通回合不产生压缩块", () => {
    const compacted = turnItemsToMessageContent({
      items: [{ type: "contextCompaction", id: "compact-1" }],
    });
    expect(JSON.parse(compacted)[0]).toEqual({
      type: "codex_context_compaction",
      status: "completed",
      sourceBreadcrumb: "app-server.item/completed",
    });

    expect(turnItemsToMessageContent({
      items: [{
        type: "agentMessage",
        id: "assistant-1",
        text: "普通回答。",
        phase: "final_answer",
        memoryCitation: null,
      }],
    })).toBe("普通回答。");
  });

  it("把工具 turn 转为 CodexWeb 过程块并保留最终回答", () => {
    const content = turnItemsToMessageContent({
      items: [
        commandExecutionItem(),
        {
          type: "agentMessage",
          id: "assistant-1",
          text: "完成。",
          phase: null,
          memoryCitation: null,
        },
      ],
      durationMs: 6120,
    });

    expect(JSON.parse(content)).toEqual([
      expect.objectContaining({ type: "tool_use", id: "cmd-1", name: "bash" }),
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "cmd-1",
        is_error: false,
      }),
      { type: "codex_summary", elapsed_ms: 6120, process_count: 1 },
      { type: "text", text: "完成。" },
    ]);
  });

  it("把 reasoning-only turn 转为 thinking 过程块", () => {
    const content = turnItemsToMessageContent({
      items: [
        {
          type: "agentMessage",
          id: "assistant-1",
          text: "最终回答。",
          phase: null,
          memoryCitation: null,
        },
      ],
      reasoningText: "我会先检查上下文。",
      durationMs: 1200,
    });

    expect(JSON.parse(content)).toEqual([
      { type: "thinking", thinking: "我会先检查上下文。" },
      { type: "codex_summary", elapsed_ms: 1200, process_count: 1 },
      { type: "text", text: "最终回答。" },
    ]);
  });

  it("把 plan item 和 updated plan block 转为时间线消息块", () => {
    const content = turnItemsToMessageContent({
      items: [
        { type: "plan", id: "plan-1", text: "1. 写测试\n2. 实现" },
        {
          type: "agentMessage",
          id: "assistant-1",
          text: "计划已准备好。",
          phase: null,
          memoryCitation: null,
        },
      ],
      planBlocks: [
        {
          type: "codex_updated_plan",
          explanation: null,
          steps: [{ step: "写测试", status: "completed" }],
          sourceBreadcrumb: "app-server.turn/plan/updated",
          progress: { completed: 1, total: 1 },
        },
      ],
    });

    expect(JSON.parse(content)).toEqual([
      {
        type: "codex_proposed_plan",
        text: "1. 写测试\n2. 实现",
        sourceBreadcrumb: "app-server.item/completed",
      },
      {
        type: "codex_updated_plan",
        explanation: null,
        steps: [{ step: "写测试", status: "completed" }],
        sourceBreadcrumb: "app-server.turn/plan/updated",
        progress: { completed: 1, total: 1 },
      },
      { type: "text", text: "计划已准备好。" },
    ]);
  });

  it("普通 final-only turn 保持纯文本", () => {
    const content = turnItemsToMessageContent({
      items: [
        {
          type: "agentMessage",
          id: "assistant-1",
          text: "直接回答。",
          phase: null,
          memoryCitation: null,
        },
      ],
      durationMs: 100,
    });

    expect(content).toBe("直接回答。");
  });

  it("把 app-server 图片媒体透传到现有 tool_result UI", () => {
    const blocks = turnItemsToMessageBlocks({
      items: [{
        type: "imageGeneration",
        id: "image-gen-1",
        status: "completed",
        revisedPrompt: null,
        result: "",
        savedPath: "/isolated-codex-home/generated/image-gen-1.png",
      }],
    });

    expect(blocks).toEqual([
      expect.objectContaining({ type: "tool_use", id: "image-gen-1" }),
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "image-gen-1",
        media: [{
          type: "image",
          mimeType: "image/png",
          localPath: "/isolated-codex-home/generated/image-gen-1.png",
        }],
      }),
      { type: "codex_summary", process_count: 1 },
    ]);
  });

  it("按 commentary、搜索、commentary、final 的原始顺序构建消息", () => {
    const content = turnItemsToMessageContent({
      items: [
        { type: "agentMessage", id: "comment-1", text: "我先检索今天的新闻。", phase: "commentary", memoryCitation: null },
        {
          type: "webSearch",
          id: "search-1",
          query: "今天科技新闻",
          action: { type: "search", query: "今天科技新闻", queries: null },
        },
        { type: "agentMessage", id: "comment-2", text: "我会核对发布日期。", phase: "commentary", memoryCitation: null },
        { type: "agentMessage", id: "final-1", text: "这是今天的科技新闻。", phase: "final_answer", memoryCitation: null },
      ],
      durationMs: 283000,
    });

    expect(JSON.parse(content)).toEqual([
      { type: "codex_process_text", text: "我先检索今天的新闻。" },
      expect.objectContaining({ type: "tool_use", id: "search-1", name: "web_search" }),
      expect.objectContaining({ type: "tool_result", tool_use_id: "search-1" }),
      { type: "codex_process_text", text: "我会核对发布日期。" },
      { type: "codex_summary", elapsed_ms: 283000, process_count: 3 },
      { type: "text", text: "这是今天的科技新闻。" },
    ]);
  });

  it("中断后保留已经收到的部分正文", () => {
    const turn = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      status: "interrupted" as const,
      assistantText: "已经输出的部分回答。",
    };

    expect(appServerTerminalTurnToMessageContent(turn)).toBe("已经输出的部分回答。");
  });

  it("中断时没有任何输出就不新增助手消息", () => {
    const turn = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      status: "interrupted" as const,
    };

    expect(appServerTerminalTurnToMessageContent(turn)).toBeNull();
  });

  it("完成回合继续保存正文，失败回合不保存为助手消息", () => {
    const completed = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      status: "completed" as const,
      assistantText: "完整回答。",
    };
    const failed = {
      ...completed,
      status: "failed" as const,
    };

    expect(appServerTerminalTurnToMessageContent(completed)).toBe("完整回答。");
    expect(appServerTerminalTurnToMessageContent(failed)).toBeNull();
  });

  it("新会话与历史会话都使用终态内容适配器且不再写入固定中断提示", () => {
    const newChatPage = readFileSync(resolve(process.cwd(), "src/app/chat/page.tsx"), "utf8");
    const chatView = readFileSync(resolve(process.cwd(), "src/components/chat/ChatView.tsx"), "utf8");

    expect(newChatPage).toContain("appServerTerminalTurnToMessageContent(appServerTurn)");
    expect(chatView).toContain("appServerTerminalTurnToMessageContent(appServerTurn)");
    expect(newChatPage).not.toContain("Codex 已中断。可以继续发送下一轮。");
    expect(chatView).not.toContain("Codex 已中断。可以继续发送下一轮。");
  });
});

function commandExecutionItem(): ThreadItem {
  return {
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
  };
}
