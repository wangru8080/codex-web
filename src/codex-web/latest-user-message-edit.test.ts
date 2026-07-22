import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Message } from "@/types";
import { dropLastUserTurns, latestEditableUserMessageId } from "./latest-user-message-edit";

const messageItem = readFileSync(new URL("../components/chat/MessageItem.tsx", import.meta.url), "utf8");

function message(id: string, role: Message["role"]): Message {
  return {
    id,
    session_id: "thread-1",
    role,
    content: id,
    created_at: "2026-07-22T08:00:00.000Z",
    token_usage: null,
  };
}

describe("最近用户问题编辑判定", () => {
  it("只返回最后一个已有助手回答的用户消息", () => {
    const messages = [
      message("user-1", "user"),
      message("assistant-1", "assistant"),
      message("user-2", "user"),
      message("assistant-2", "assistant"),
    ];

    expect(latestEditableUserMessageId(messages, false)).toBe("user-2");
  });

  it("生成中或最后问题还没有回答时不可编辑", () => {
    const completed = [message("user-1", "user"), message("assistant-1", "assistant")];
    const unanswered = [...completed, message("user-2", "user")];

    expect(latestEditableUserMessageId(completed, true)).toBeNull();
    expect(latestEditableUserMessageId(unanswered, false)).toBeNull();
  });

  it("编辑器包含可访问名称、取消和发送入口", () => {
    expect(messageItem).toContain('aria-label={t(\'message.edit\'');
    expect(messageItem).toContain("message.edit.cancel");
    expect(messageItem).toContain("message.edit.send");
    expect(messageItem).toContain("data-user-message-editor");
  });

  it("跨客户端 rollback 丢弃最后一轮用户消息及其回答", () => {
    const messages = [
      message("user-1", "user"),
      message("assistant-1", "assistant"),
      message("user-2", "user"),
      message("assistant-2", "assistant"),
    ];

    expect(dropLastUserTurns(messages, 1).map((entry) => entry.id)).toEqual(["user-1", "assistant-1"]);
  });
});
