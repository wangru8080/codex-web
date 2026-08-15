import { describe, expect, it } from "vitest";

import { createAcceptedTurnState } from "../turn-reducer";
import {
  shouldUpdateActiveTurnFromNotification,
  turnNotificationBase,
} from "../turn-notification-routing";

describe("Turn notification 路由", () => {
  const active = createAcceptedTurnState("thread-1", "turn-b");
  const snapshot = {
    ...createAcceptedTurnState("thread-1", "turn-a"),
    assistantText: "Turn A",
  };

  it("迟到的 Turn A 通知使用 Turn A snapshot，而不是当前 Turn B", () => {
    expect(turnNotificationBase({
      activeTurn: active,
      snapshotTurn: snapshot,
      ids: { threadId: "thread-1", turnId: "turn-a" },
    })).toBe(snapshot);
  });

  it("迟到的 Turn A 通知不得更新当前 Turn B", () => {
    expect(shouldUpdateActiveTurnFromNotification(active, {
      threadId: "thread-1",
      turnId: "turn-a",
    })).toBe(false);
    expect(shouldUpdateActiveTurnFromNotification(active, {
      threadId: "thread-1",
      turnId: "turn-b",
    })).toBe(true);
  });
});
