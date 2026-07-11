import { describe, expect, it } from "vitest";

import type { Message } from "@/types";

import {
  historyPaginationFailureNotice,
  preserveMessagesAfterPaginationFailure,
} from "./history-pagination-state";

describe("history-pagination-state", () => {
  it("把分页 Error 转成统一的可见提示", () => {
    expect(historyPaginationFailureNotice(new Error("cursor expired"))).toEqual({
      message: "历史分页暂不可用",
      description: "cursor expired",
    });
  });

  it("保留非 Error 分页失败原因", () => {
    expect(historyPaginationFailureNotice("bridge closed")).toEqual({
      message: "历史分页暂不可用",
      description: "bridge closed",
    });
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
