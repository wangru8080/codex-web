import { describe, expect, it } from "vitest";

import type { Message } from "@/types";
import {
  CROSS_CLIENT_THREAD_ROLLBACK_METHOD,
  CROSS_CLIENT_USER_MESSAGE_METHOD,
  initialCrossClientUserMessageState,
  mergeCrossClientUserMessages,
  readCrossClientUserMessage,
  readCrossClientThreadRollback,
  reduceCrossClientUserMessage,
} from "./cross-client-sync";

describe("readCrossClientThreadRollback", () => {
  it("只接受正整数轮数和完整 thread/event id", () => {
    expect(readCrossClientThreadRollback({
      method: CROSS_CLIENT_THREAD_ROLLBACK_METHOD,
      params: { eventId: "rollback-1", threadId: "thread-1", numTurns: 1 },
    })).toEqual({ eventId: "rollback-1", threadId: "thread-1", numTurns: 1 });
    expect(readCrossClientThreadRollback({
      method: CROSS_CLIENT_THREAD_ROLLBACK_METHOD,
      params: { eventId: "rollback-2", threadId: "thread-1", numTurns: 0 },
    })).toBeNull();
  });
});

function message(id: string, threadId = "thread-1"): Message {
  return {
    id,
    session_id: threadId,
    role: "user",
    content: `消息 ${id}`,
    created_at: `2026-07-19T00:00:${id.padStart(2, "0")}Z`,
    token_usage: null,
  };
}

function notification(id: string, threadId = "thread-1", isNewThread = false) {
  return {
    method: CROSS_CLIENT_USER_MESSAGE_METHOD,
    params: {
      threadId,
      turnId: `turn-${id}`,
      isNewThread,
      message: message(id, threadId),
    },
  };
}

describe("readCrossClientUserMessage", () => {
  it("读取合法事件并拒绝错误 method 或不匹配的 session", () => {
    expect(readCrossClientUserMessage(notification("1")))?.toMatchObject({
      threadId: "thread-1",
      turnId: "turn-1",
      isNewThread: false,
    });
    expect(readCrossClientUserMessage({ method: "turn/started", params: {} })).toBeNull();
    expect(readCrossClientUserMessage({
      ...notification("2"),
      params: { ...notification("2").params, message: message("2", "thread-2") },
    })).toBeNull();
  });
});

describe("reduceCrossClientUserMessage", () => {
  it("按 thread 隔离、按消息 id 去重并记录最新事件", () => {
    const first = reduceCrossClientUserMessage(initialCrossClientUserMessageState, notification("1", "thread-1", true));
    const duplicate = reduceCrossClientUserMessage(first, notification("1", "thread-1", true));
    const secondThread = reduceCrossClientUserMessage(duplicate, notification("2", "thread-2"));

    expect(secondThread.byThreadId["thread-1"]).toHaveLength(1);
    expect(secondThread.byThreadId["thread-2"]?.[0].message.id).toBe("2");
    expect(secondThread.latest?.threadId).toBe("thread-2");
  });

  it("每个 thread 只保留最近 50 条", () => {
    let state = initialCrossClientUserMessageState;
    for (let index = 0; index < 55; index += 1) {
      state = reduceCrossClientUserMessage(state, notification(String(index)));
    }

    expect(state.byThreadId["thread-1"]).toHaveLength(50);
    expect(state.byThreadId["thread-1"]?.[0].message.id).toBe("5");
    expect(state.byThreadId["thread-1"]?.[49].message.id).toBe("54");
  });

  it("非法事件不改变状态对象", () => {
    expect(reduceCrossClientUserMessage(initialCrossClientUserMessageState, {
      method: CROSS_CLIENT_USER_MESSAGE_METHOD,
      params: { threadId: "thread-1" },
    })).toBe(initialCrossClientUserMessageState);
  });
});

describe("mergeCrossClientUserMessages", () => {
  it("保留现有顺序，只追加尚未显示的用户消息", () => {
    const existing = [message("1")];
    const events = [
      readCrossClientUserMessage(notification("1")),
      readCrossClientUserMessage(notification("2")),
    ].filter((event): event is NonNullable<typeof event> => event !== null);

    expect(mergeCrossClientUserMessages(existing, events).map((entry) => entry.id)).toEqual(["1", "2"]);
  });
});
