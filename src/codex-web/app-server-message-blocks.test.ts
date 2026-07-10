import { describe, expect, it } from "vitest";

import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import { turnItemsToMessageContent } from "./app-server-message-blocks";

describe("app-server-message-blocks", () => {
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
