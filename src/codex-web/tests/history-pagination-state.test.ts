import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Message } from "@/types";

import {
  historyPaginationFailureNotice,
  isUnsupportedTurnsListError,
  preserveMessagesAfterPaginationFailure,
} from "../history-pagination-state";

const chatPageSource = readFileSync(
  new URL("../../app/chat/[id]/page.tsx", import.meta.url),
  "utf8",
);

describe("history-pagination-state", () => {
  it("把分页 Error 转成统一的可见提示", () => {
    expect(historyPaginationFailureNotice(new Error("cursor expired"))).toEqual({
      message: "历史分页暂不可用",
      description: "cursor expired",
    });
  });

  it("支持英文环境的分页提示", () => {
    expect(historyPaginationFailureNotice(new Error("cursor expired"), true)).toEqual({
      message: "History pagination is unavailable",
      description: "cursor expired",
    });
  });

  it("保留非 Error 分页失败原因", () => {
    expect(historyPaginationFailureNotice("bridge closed")).toEqual({
      message: "历史分页暂不可用",
      description: "bridge closed",
    });
  });

  it("识别 unsupported turns list 错误", () => {
    expect(isUnsupportedTurnsListError(new Error("list_turns is not supported yet"))).toBe(true);
    expect(isUnsupportedTurnsListError("Method not found: thread/turns/list")).toBe(true);
    expect(isUnsupportedTurnsListError(new Error("method not supported"))).toBe(true);
    expect(isUnsupportedTurnsListError(new Error("unknown method: thread/turns/list"))).toBe(true);
    expect(isUnsupportedTurnsListError(new Error("network timeout"))).toBe(false);
    expect(isUnsupportedTurnsListError(null)).toBe(false);
  });

  it("动态对话页遇到 unsupported list_turns 并在 fallback 成功时不展示分页错误横幅", () => {
    expect(chatPageSource).toContain("isUnsupportedTurnsListError");
    expect(chatPageSource).toContain("if (fallbackSucceeded && isUnsupportedTurnsListError(pageError))");
    expect(chatPageSource).toContain("setPaginationNotice(null)");
  });

  it("动态对话页在定位接续任务边界时支持 unsupported list_turns 回退", () => {
    expect(chatPageSource).toContain("if (isUnsupportedTurnsListError(boundaryError))");
    expect(chatPageSource).toContain("const parentResponse = await readThread(parentThreadId, { includeTurns: true })");
  });

  it("加载更早消息失败时保留当前消息并关闭后续分页", () => {
    const messages: Message[] = [
      {
        id: "message-1",
        session_id: "thread-1",
        role: "assistant",
        content: "已有消息",
        created_at: "2026-07-12T00:00:00.000Z",
        token_usage: null,
      },
    ];

    const failure = preserveMessagesAfterPaginationFailure(
      messages,
      new Error("thread/turns/list failed"),
    );

    expect(failure.messages).toBe(messages);
    expect(failure.hasMore).toBe(false);
    expect(failure.nextCursor).toBeNull();
    expect(failure.notice).toEqual({
      message: "历史分页暂不可用",
      description: "thread/turns/list failed",
    });
  });
});
